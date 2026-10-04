import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { disputeReviewChannelId } from './discord.js';
import {
  INVENTORY_GRANTS,
  credit,
  debit,
  grantInventoryItem,
  grantsAvailable,
  inventoryItems,
  removeInventoryItem,
  settleAgreed,
} from './logic.js';
import { fail, load, rid, round, update } from './store.js';

const commands = [
  new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Create a site tournament')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Open a cup players can join on the site')
        .addStringOption((option) => option.setName('name').setDescription('Cup name').setRequired(true).setMaxLength(80))
        .addIntegerOption((option) =>
          option.setName('players').setDescription('Maximum players').setRequired(true).setMinValue(3)
        )
        .addNumberOption((option) => option.setName('entry').setDescription('Entry fee in tokens').setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName('hours').setDescription('How long the cup stays open').setRequired(true).setMinValue(0.01))
        .addNumberOption((option) => option.setName('first').setDescription('1st place prize in tokens').setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName('second').setDescription('2nd place prize in tokens').setRequired(true).setMinValue(0))
        .addNumberOption((option) => option.setName('third').setDescription('3rd place prize in tokens').setRequired(true).setMinValue(0))
    ),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a site account from login and matchmaking')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    )
    .addNumberOption((option) => option.setName('hours').setDescription('Ban length in hours').setRequired(true).setMinValue(0.01)),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Clear a site ban')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    ),
  new SlashCommandBuilder()
    .setName('matchmaking')
    .setDescription('Turn 1v1 matchmaking on or off')
    .addBooleanOption((option) => option.setName('enabled').setDescription('On allows new 1v1 listings').setRequired(true))
    .addNumberOption((option) =>
      option.setName('hours').setDescription('How long to keep matchmaking off').setRequired(false).setMinValue(0.01)
    ),
  new SlashCommandBuilder()
    .setName('reviewer')
    .setDescription('Add or remove a match reviewer')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Let a Discord user award clip-dispute winners')
        .addUserOption((option) => option.setName('user').setDescription('Discord user').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop a Discord user from awarding clip-dispute winners')
        .addUserOption((option) => option.setName('user').setDescription('Discord user').setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show a site user token balance')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    ),
  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show a site user inventory and add or remove items')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    ),
  new SlashCommandBuilder()
    .setName('giveall')
    .setDescription('Give tokens or an inventory item to every registered user')
    .addSubcommand((sub) =>
      sub
        .setName('tokens')
        .setDescription('Credit tokens to every registered user')
        .addNumberOption((option) =>
          option.setName('amount').setDescription('Tokens to add').setRequired(true).setMinValue(0.01)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('item')
        .setDescription('Grant an inventory item to every registered user')
        .addStringOption((option) =>
          option
            .setName('item')
            .setDescription('Item to grant')
            .setRequired(true)
            .addChoices(...INVENTORY_GRANTS.map((grant) => ({ name: grant.label, value: grant.key })))
        )
    ),
  new SlashCommandBuilder()
    .setName('tokens')
    .setDescription('Add or remove site tokens')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Credit a site user')
        .addStringOption((option) =>
          option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
        )
        .addNumberOption((option) => option.setName('amount').setDescription('Tokens to add').setRequired(true).setMinValue(0.01))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Debit a site user')
        .addStringOption((option) =>
          option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
        )
        .addNumberOption((option) => option.setName('amount').setDescription('Tokens to remove').setRequired(true).setMinValue(0.01))
    ),
].map((command) => command.toJSON());

function adminIds() {
  return String(process.env.DISCORD_ADMIN_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{5,32}$/.test(id));
}

function money(raw) {
  const value = round(raw);
  if (!Number.isFinite(value) || value < 0) fail(400, 'Enter a token amount');
  return value;
}

function hours(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(400, 'Enter how many hours');
  return value;
}

function findAccount(state, username) {
  const query = String(username || '').trim().toLowerCase();
  if (!query) return null;
  return (
    state.users.find((user) => !user.npc && user.username.toLowerCase() === query) ||
    state.users.find((user) => !user.npc && String(user.discordUsername || '').toLowerCase() === query) ||
    null
  );
}

function clearSessions(state, userId) {
  for (const [token, id] of Object.entries(state.sessions || {})) {
    if (id === userId) delete state.sessions[token];
  }
}

function createTournament(options) {
  const name = String(options.getString('name') || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  const players = options.getInteger('players');
  const entry = money(options.getNumber('entry'));
  const length = hours(options.getNumber('hours'));
  const places = [money(options.getNumber('first')), money(options.getNumber('second')), money(options.getNumber('third'))];
  if (!name) fail(400, 'Enter a cup name');
  if (!Number.isInteger(players) || players < 3) fail(400, 'Players must be at least 3');
  return update((state) => {
    if (!Array.isArray(state.tournaments)) state.tournaments = [];
    const cup = {
      id: rid('cup'),
      name,
      blurb: `Up to ${players} players. Entry ${entry}. Prizes ${places.join(' / ')} for 1st, 2nd, and 3rd.`,
      entry,
      prize: round(places[0] + places[1] + places[2]),
      places,
      maxPlayers: players,
      endsAt: Date.now() + length * 60 * 60 * 1000,
      paidOut: false,
      board: [],
    };
    state.tournaments.unshift(cup);
    return cup;
  });
}

function banAccount(username, lengthHours) {
  const length = hours(lengthHours);
  return update((state) => {
    const user = findAccount(state, username);
    if (!user) fail(404, 'No player by that name');
    user.banUntil = Date.now() + length * 60 * 60 * 1000;
    clearSessions(state, user.id);
    return { username: user.username, banUntil: user.banUntil };
  });
}

function unbanAccount(username) {
  return update((state) => {
    const user = findAccount(state, username);
    if (!user) fail(404, 'No player by that name');
    user.banUntil = 0;
    return { username: user.username };
  });
}

function tokenAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(400, 'Enter a positive token amount');
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) fail(400, 'Use at most 2 decimal places');
  return cents / 100;
}

function discordUserId(user) {
  const id = String(user?.id || '');
  if (!/^\d{5,32}$/.test(id)) fail(400, 'That user is not valid');
  return id;
}

function reviewersOf(state) {
  if (!Array.isArray(state.reviewers)) state.reviewers = [];
  return state.reviewers;
}

function isReviewer(userId) {
  const reviewers = load().reviewers;
  return Array.isArray(reviewers) && reviewers.includes(userId);
}

function addReviewer(user) {
  const id = discordUserId(user);
  return update((state) => {
    const reviewers = reviewersOf(state);
    if (!reviewers.includes(id)) reviewers.push(id);
    return { id };
  });
}

function removeReviewer(user) {
  const id = discordUserId(user);
  return update((state) => {
    const reviewers = reviewersOf(state);
    const index = reviewers.indexOf(id);
    if (index === -1) fail(404, 'That user is not a reviewer');
    reviewers.splice(index, 1);
    return { id };
  });
}

function userBalance(username) {
  const user = findAccount(load(), username);
  if (!user) fail(404, 'No player by that name');
  return { username: user.username, balance: round(user.balance) };
}

function inventoryMessage(user) {
  const items = inventoryItems(user);
  const shown = items.slice(0, 25);
  const rest = items.slice(25);
  const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(`${user.username} inventory`);
  if (!items.length) {
    embed.setDescription('They own nothing.');
  } else {
    embed.setDescription(shown.map((item) => `**${item.label}** — ${item.detail}`).join('\n'));
    if (rest.length) {
      embed.addFields({
        name: 'Also owned',
        value: `${rest.map((item) => item.label).join(', ')}. Those are not on buttons here.`.slice(0, 1024),
      });
    }
  }
  const components = [];
  for (let index = 0; index < shown.length; index += 5) {
    const row = new ActionRowBuilder();
    for (const item of shown.slice(index, index + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`oginv:${user.id}:${item.key}`)
          .setLabel(item.button.slice(0, 80))
          .setStyle(ButtonStyle.Danger)
      );
    }
    components.push(row);
  }
  const grants = grantsAvailable(user);
  if (grants.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ogadd:${user.id}`)
          .setPlaceholder('Add an item')
          .addOptions(
            grants.map((grant) =>
              new StringSelectMenuOptionBuilder().setLabel(grant.label.slice(0, 100)).setValue(grant.key)
            )
          )
      )
    );
  }
  return { embeds: [embed], components };
}

function lookupInventory(username) {
  const user = findAccount(load(), username);
  if (!user) fail(404, 'No player by that name');
  return inventoryMessage(user);
}

function stripInventory(userId, key) {
  return update((state) => {
    const user = state.users.find((entry) => !entry.npc && entry.id === userId);
    if (!user) fail(404, 'No player by that name');
    removeInventoryItem(user, key);
    return inventoryMessage(user);
  });
}

function addInventory(userId, key) {
  return update((state) => {
    const user = state.users.find((entry) => !entry.npc && entry.id === userId);
    if (!user) fail(404, 'No player by that name');
    if (!grantInventoryItem(user, key)) fail(400, 'They already have that');
    return inventoryMessage(user);
  });
}

function registeredUsers(state) {
  return state.users.filter((user) => user && !user.npc);
}

function giveAllTokens(rawAmount) {
  const amount = tokenAmount(rawAmount);
  return update((state) => {
    const users = registeredUsers(state);
    for (const user of users) credit(state, user, amount, 'adjust', { note: 'discord-giveall' });
    return { updated: users.length };
  });
}

function giveAllItem(key) {
  if (!INVENTORY_GRANTS.some((grant) => grant.key === key)) fail(400, 'That item cannot be added');
  return update((state) => {
    let updated = 0;
    for (const user of registeredUsers(state)) {
      if (grantInventoryItem(user, key)) updated += 1;
    }
    return { updated };
  });
}

function adjustTokens(username, rawAmount, direction) {
  const amount = tokenAmount(rawAmount);
  return update((state) => {
    const user = findAccount(state, username);
    if (!user) fail(404, 'No player by that name');
    if (direction === 'add') credit(state, user, amount, 'adjust', { note: 'discord' });
    else debit(state, user, amount, 'adjust', { note: 'discord' });
    return { username: user.username, balance: user.balance };
  });
}

function setMatchmaking(enabled, lengthHours) {
  return update((state) => {
    if (enabled) {
      state.matchmakingDisabledUntil = 0;
      return { enabled: true, until: 0 };
    }
    const length = hours(lengthHours);
    state.matchmakingDisabledUntil = Date.now() + length * 60 * 60 * 1000;
    return { enabled: false, until: state.matchmakingDisabledUntil };
  });
}

let bot = null;
let botFailed = false;
let afterReviewSettled = () => {};

export function setReviewSettleHook(fn) {
  afterReviewSettled = typeof fn === 'function' ? fn : () => {};
}

function reviewUnavailable() {
  const error = new Error('Review channel is not configured');
  error.status = 503;
  throw error;
}

function reviewUnreachable() {
  const error = new Error('Could not reach the review channel');
  error.status = 502;
  throw error;
}

function waitForBot() {
  if (botFailed || !bot) return Promise.resolve(null);
  if (bot.isReady()) return Promise.resolve(bot);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(bot && bot.isReady() ? bot : null), 12000);
    bot.once('ready', () => {
      clearTimeout(timer);
      resolve(bot);
    });
  });
}

export async function sendClipReview(payload) {
  const channelId = await disputeReviewChannelId();
  if (!channelId) reviewUnavailable();
  const client = await waitForBot();
  if (!client) reviewUnavailable();
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    reviewUnreachable();
  }
  if (!channel || typeof channel.send !== 'function') reviewUnreachable();
  try {
    await channel.send({
      embeds: Array.isArray(payload?.embeds) ? payload.embeds : [],
      components: Array.isArray(payload?.components) ? payload.components : [],
    });
  } catch {
    reviewUnreachable();
  }
}

function freezeAwardButtons(rows) {
  return (rows || []).map((row) =>
    new ActionRowBuilder().addComponents(
      row.components.map((component) => {
        const button = ButtonBuilder.from(component);
        if (String(component.customId || '').startsWith('ogreview:')) button.setDisabled(true);
        return button;
      })
    )
  );
}

async function handleAward(interaction) {
  const userId = interaction.user.id;
  if (!adminIds().includes(userId) && !isReviewer(userId)) {
    await interaction.reply({ content: 'You cannot use this', ephemeral: true });
    return;
  }
  const [, side, ...rest] = String(interaction.customId || '').split(':');
  const matchId = rest.join(':');
  if ((side !== 'host' && side !== 'guest') || !matchId) {
    await interaction.reply({ content: 'That award is not valid', ephemeral: true });
    return;
  }
  let settled = false;
  try {
    update((state) => {
      const match = state.matches.find((item) => item.id === matchId);
      if (!match || match.status === 'done') return;
      const winnerId = side === 'host' ? match.hostId : match.guestId;
      settleAgreed(state, match, winnerId);
      if (match.review) {
        match.review.host = '';
        match.review.guest = '';
      }
      settled = true;
    });
  } catch (error) {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: error.status ? error.message : 'That award failed', ephemeral: true });
    return;
  }
  await interaction.update({ components: freezeAwardButtons(interaction.message.components) });
  if (settled) afterReviewSettled(matchId);
}

async function handleInventoryButton(interaction) {
  if (!adminIds().includes(interaction.user.id)) {
    await interaction.reply({ content: 'You cannot use this', ephemeral: true });
    return;
  }
  const body = String(interaction.customId || '').slice('oginv:'.length);
  const split = body.lastIndexOf(':');
  const userId = split === -1 ? '' : body.slice(0, split);
  const key = split === -1 ? '' : body.slice(split + 1);
  if (!userId || !key) {
    await interaction.reply({ content: 'That item is not valid', ephemeral: true });
    return;
  }
  let payload;
  try {
    payload = stripInventory(userId, key);
  } catch (error) {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: error.status ? error.message : 'That removal failed', ephemeral: true });
    return;
  }
  await interaction.update(payload);
}

async function handleInventoryAdd(interaction) {
  if (!adminIds().includes(interaction.user.id)) {
    await interaction.reply({ content: 'You cannot use this', ephemeral: true });
    return;
  }
  const userId = String(interaction.customId || '').slice('ogadd:'.length);
  const key = interaction.values?.[0];
  if (!userId || !key) {
    await interaction.reply({ content: 'That item is not valid', ephemeral: true });
    return;
  }
  let payload;
  try {
    payload = addInventory(userId, key);
  } catch (error) {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: error.status ? error.message : 'That add failed', ephemeral: true });
    return;
  }
  await interaction.update(payload);
}

async function handleCommand(interaction) {
  const allowed = adminIds();
  if (!allowed.length) {
    await interaction.reply({ content: 'Admin is not configured', ephemeral: true });
    return;
  }
  if (!allowed.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You cannot use this command', ephemeral: true });
    return;
  }
  try {
    if (interaction.commandName === 'tournament' && interaction.options.getSubcommand() === 'create') {
      const cup = createTournament(interaction.options);
      await interaction.reply({
        content: `Cup ${cup.name} is open for ${cup.maxPlayers} players until <t:${Math.floor(cup.endsAt / 1000)}:f>.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'ban') {
      const result = banAccount(interaction.options.getString('username'), interaction.options.getNumber('hours'));
      await interaction.reply({
        content: `${result.username} is banned until <t:${Math.floor(result.banUntil / 1000)}:f>.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'unban') {
      const result = unbanAccount(interaction.options.getString('username'));
      await interaction.reply({ content: `${result.username} can sign in again.`, ephemeral: true });
      return;
    }
    if (interaction.commandName === 'matchmaking') {
      const enabled = interaction.options.getBoolean('enabled');
      const result = setMatchmaking(enabled, interaction.options.getNumber('hours'));
      await interaction.reply({
        content: result.enabled
          ? 'Matchmaking is on.'
          : `Matchmaking is off until <t:${Math.floor(result.until / 1000)}:f>.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'reviewer') {
      const member = interaction.options.getUser('user');
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        addReviewer(member);
        await interaction.reply({ content: `${member.username} can award match winners.`, ephemeral: true });
        return;
      }
      if (sub === 'remove') {
        removeReviewer(member);
        await interaction.reply({ content: `${member.username} is no longer a reviewer.`, ephemeral: true });
      }
      return;
    }
    if (interaction.commandName === 'balance') {
      const result = userBalance(interaction.options.getString('username'));
      await interaction.reply({
        content: `${result.username} has ${Number(result.balance).toFixed(2)} tokens.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'inventory') {
      const payload = lookupInventory(interaction.options.getString('username'));
      await interaction.reply({ ...payload, ephemeral: true });
      return;
    }
    if (interaction.commandName === 'giveall') {
      const sub = interaction.options.getSubcommand();
      const result = sub === 'tokens' ? giveAllTokens(interaction.options.getNumber('amount')) : giveAllItem(interaction.options.getString('item'));
      await interaction.reply({
        content: `Updated ${result.updated} user${result.updated === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'tokens') {
      const username = interaction.options.getString('username');
      const amount = interaction.options.getNumber('amount');
      const sub = interaction.options.getSubcommand();
      const result = adjustTokens(username, amount, sub === 'add' ? 'add' : 'remove');
      await interaction.reply({
        content: `${result.username} now has ${result.balance} tokens.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    const content = error.status ? error.message : 'That command failed';
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content, ephemeral: true });
  }
}

export function startDiscordAdmin() {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Discord admin commands are not configured');
    return;
  }
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  botFailed = false;
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  bot = client;
  client.once('ready', async () => {
    if (!/^\d{5,32}$/.test(guildId)) {
      console.log('DISCORD_GUILD_ID is missing; Discord slash commands were not registered');
      return;
    }
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
      console.log('Discord admin slash commands registered');
    } catch (error) {
      console.error('Discord slash command registration failed', error.status || '');
    }
  });
  client.on('interactionCreate', (interaction) => {
    if (interaction.isButton() && String(interaction.customId || '').startsWith('ogreview:')) {
      handleAward(interaction).catch(() => {});
      return;
    }
    if (interaction.isButton() && String(interaction.customId || '').startsWith('oginv:')) {
      handleInventoryButton(interaction).catch(() => {});
      return;
    }
    if (interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('ogadd:')) {
      handleInventoryAdd(interaction).catch(() => {});
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    handleCommand(interaction).catch(() => {});
  });
  client.on('error', () => {
    console.error('Discord admin bot error');
  });
  client.login(token).catch(() => {
    botFailed = true;
    console.error('Discord admin bot could not log in');
  });
}
