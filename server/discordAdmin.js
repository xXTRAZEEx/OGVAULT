import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  GatewayIntentBits,
  ActivityType,
  PermissionFlagsBits,
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
import { blackjackBiasPercent, setBlackjackBias } from './blackjack.js';
import { fail, isVip, load, rid, round, update } from './store.js';

const GOLD_VIP_ROLE_NAME = 'GOLD VIP';
const GOLD_VIP_COLOR = 0xf5c451;
const REVIEWER_CHANNEL_ID = '1556086496207962122';
const REVIEWER_ROLE_NAME = 'Reviewer';
const REVIEWER_COLOR = 0x57f287;
const REVIEWER_PERMISSIONS = [PermissionFlagsBits.ReadMessageHistory];

function adminOnly(builder) {
  return builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

const commands = [
  adminOnly(new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Create a site tournament'))
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
  adminOnly(new SlashCommandBuilder()
    .setName('clearchat')
    .setDescription("Clear the site's public Live Chat")),
  adminOnly(new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete every message in this Discord channel')),
  adminOnly(new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Blackjack house settings'))
    .addSubcommand((sub) =>
      sub
        .setName('bias')
        .setDescription('Show or set how often a player win is settled for the dealer')
        .addIntegerOption((option) =>
          option
            .setName('percent')
            .setDescription('0 is fair, 100 is the maximum dealer edge')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(100)
        )
    ),
  adminOnly(new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give a Discord role to a member')
    .addUserOption((option) => option.setName('user').setDescription('Discord user').setRequired(true))
    .addRoleOption((option) => option.setName('role').setDescription('Role to give').setRequired(true))),
  adminOnly(new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show live site numbers')),
  adminOnly(new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a site account from login and matchmaking')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    )
    .addNumberOption((option) => option.setName('hours').setDescription('Ban length in hours').setRequired(true).setMinValue(0.01))),
  adminOnly(new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Clear a site ban')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('matchmaking')
    .setDescription('Turn Kill Race matchmaking on or off')
    .addBooleanOption((option) => option.setName('enabled').setDescription('On allows new Kill Race listings').setRequired(true))
    .addNumberOption((option) =>
      option.setName('hours').setDescription('How long to keep matchmaking off').setRequired(false).setMinValue(0.01)
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('website')
    .setDescription('Take the whole site offline or bring it back')
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Online or offline')
        .setRequired(true)
        .addChoices({ name: 'Online', value: 'online' }, { name: 'Offline', value: 'offline' })
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Shown on the offline page')
        .addChoices({ name: 'Repair', value: 'repair' }, { name: 'Maintenance', value: 'maintenance' })
    )
    .addIntegerOption((option) =>
      option.setName('length').setDescription('How long until the site is back').setMinValue(1).setMaxValue(365)
    )
    .addStringOption((option) =>
      option
        .setName('unit')
        .setDescription('Hours or days')
        .addChoices({ name: 'Hours', value: 'hours' }, { name: 'Days', value: 'days' })
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show a site user token balance')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show a site user inventory and add or remove items')
    .addStringOption((option) =>
      option.setName('username').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
    )),
  adminOnly(new SlashCommandBuilder()
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
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('withdrawals')
    .setDescription('List pending token withdrawal requests')
    .addSubcommand((sub) => sub.setName('list').setDescription('Show pending withdrawals'))),
  adminOnly(new SlashCommandBuilder()
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
    )),
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

function isReviewer(userId) {
  const reviewers = load().reviewers;
  return Array.isArray(reviewers) && reviewers.includes(userId);
}

let reviewerRoleId = '';

function memberHasReviewerRole(interaction) {
  if (isReviewer(interaction.user?.id)) return true;
  const roles = interaction.member?.roles;
  if (!reviewerRoleId || !roles) return false;
  if (typeof roles.cache?.has === 'function') return roles.cache.has(reviewerRoleId);
  return Array.isArray(roles) && roles.includes(reviewerRoleId);
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

async function purgeChannel(channel) {
  if (!channel?.messages?.fetch || !channel.bulkDelete) fail(400, 'Run this in a server text channel');
  let removed = 0;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100 });
    if (!batch.size) break;
    const recent = batch.filter((message) => Date.now() - message.createdTimestamp < TWO_WEEKS_MS);
    const older = batch.filter((message) => Date.now() - message.createdTimestamp >= TWO_WEEKS_MS);
    if (recent.size) {
      const deleted = await channel.bulkDelete(recent, true);
      removed += deleted.size;
    }
    for (const message of older.values()) {
      await message.delete();
      removed += 1;
    }
    if (batch.size < 100) break;
  }
  return removed;
}

async function ensureGoldVipRole(guild) {
  await guild.roles.fetch();
  let role = guild.roles.cache.find((item) => item.name === GOLD_VIP_ROLE_NAME)
    || guild.roles.cache.find((item) => item.name === 'goldVip');
  if (!role) {
    role = await guild.roles.create({
      name: GOLD_VIP_ROLE_NAME,
      color: GOLD_VIP_COLOR,
      hoist: true,
      reason: 'OG VIP buyers',
    });
  } else if (role.name !== GOLD_VIP_ROLE_NAME || role.color !== GOLD_VIP_COLOR || !role.hoist) {
    await role.edit({ name: GOLD_VIP_ROLE_NAME, color: GOLD_VIP_COLOR, hoist: true });
  }
  const member = guild.roles.cache.find((item) => item.name === 'Member');
  if (member && role.position <= member.position) {
    await role.setPosition(member.position + 1, { reason: 'GOLD VIP sits above Member' });
  }
  return role;
}

export async function syncGoldVip(user) {
  if (!bot?.isReady?.() || !user?.discordId) return;
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!/^\d{5,32}$/.test(guildId)) return;
  try {
    const guild = await bot.guilds.fetch(guildId);
    const role = await ensureGoldVipRole(guild);
    if (isVip(user)) {
      await guild.members.addRole({ user: String(user.discordId), role, reason: 'OG VIP is active' });
    } else {
      await guild.members.removeRole({ user: String(user.discordId), role, reason: 'OG VIP ended' });
    }
  } catch (error) {
    console.error('goldVip role sync failed', error.status || error.code || '');
  }
}

async function sweepGoldVip() {
  const users = load().users || [];
  for (const user of users) {
    if (!user?.discordId || user.npc || !user.vipUntil) continue;
    await syncGoldVip(user);
  }
}

async function ensureReviewerRole(guild) {
  await guild.roles.fetch();
  let role = guild.roles.cache.find((item) => item.name === REVIEWER_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: REVIEWER_ROLE_NAME,
      color: REVIEWER_COLOR,
      permissions: REVIEWER_PERMISSIONS,
      mentionable: true,
      reason: 'OGVAULT match reviewers',
    });
  } else if (
    role.color !== REVIEWER_COLOR ||
    !role.mentionable ||
    role.permissions.has(PermissionFlagsBits.ManageEvents) ||
    !role.permissions.has(PermissionFlagsBits.ReadMessageHistory)
  ) {
    await role.edit({
      color: REVIEWER_COLOR,
      permissions: REVIEWER_PERMISSIONS,
      mentionable: true,
    });
  }
  reviewerRoleId = role.id;
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel?.permissionOverwrites) continue;
    const home = channel.id === REVIEWER_CHANNEL_ID;
    await channel.permissionOverwrites.edit(role, {
      ViewChannel: home,
      SendMessages: home,
      ReadMessageHistory: true,
      UseApplicationCommands: home,
      ManageEvents: false,
    });
  }
  return role;
}

function listWithdrawals() {
  const state = load();
  const rows = (state.withdrawals || []).filter((row) => row.status === 'pending').slice(0, 15);
  if (!rows.length) return 'No pending withdrawals.';
  return rows
    .map((row) => {
      const user = state.users.find((item) => item.id === row.userId);
      const name = user?.username || 'unknown';
      const amount = round(row.amount);
      const fee = row.fee == null ? 0 : round(row.fee);
      const payout = row.payout == null ? amount : round(row.payout);
      return `${name}: ${amount} withdrawn, fee ${fee}, pay ${payout} via ${row.method}`;
    })
    .join('\n')
    .slice(0, 1900);
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

function setWebsite(status, reason, length, unit) {
  return update((state) => {
    if (status === 'online') {
      state.websiteOffline = false;
      state.websiteReason = '';
      state.websiteBackAt = 0;
      return { online: true, reason: '', until: 0 };
    }
    const why = reason === 'repair' ? 'repair' : 'maintenance';
    let until = 0;
    if (length != null) {
      const count = Number(length);
      if (!Number.isInteger(count) || count < 1) fail(400, 'Enter a whole number of hours or days');
      const hoursLong = (unit === 'days' ? count * 24 : count);
      until = Date.now() + hoursLong * 60 * 60 * 1000;
    }
    state.websiteOffline = true;
    state.websiteReason = why;
    state.websiteBackAt = until;
    return { online: false, reason: why, until };
  });
}

let bot = null;
let botFailed = false;

function applyBotStatus() {
  if (!bot?.user) return;
  const state = load();
  const backAt = Number(state.websiteBackAt) || 0;
  const offline = !!state.websiteOffline && (!backAt || backAt > Date.now());
  const text = offline ? 'Offline · ogvault.co.uk' : 'ogvault.co.uk';
  bot.user.setPresence({
    status: offline ? 'dnd' : 'online',
    activities: [{ type: ActivityType.Custom, name: 'status', state: text }],
  });
}
let afterReviewSettled = () => {};
let afterChatCleared = () => {};

export function setReviewSettleHook(fn) {
  afterReviewSettled = typeof fn === 'function' ? fn : () => {};
}

export function setChatClearedHook(fn) {
  afterChatCleared = typeof fn === 'function' ? fn : () => {};
}

let onlineCount = () => 0;

export function setOnlineCount(fn) {
  onlineCount = typeof fn === 'function' ? fn : () => 0;
}

function moneyText(value) {
  return Number(round(value) || 0).toFixed(2);
}

function siteStatsEmbed() {
  const state = load();
  const users = (state.users || []).filter((user) => !user.npc);
  const matches = state.matches || [];
  const count = (statuses) => matches.filter((match) => statuses.includes(match.status)).length;
  const games = Math.round(users.reduce((sum, user) => sum + (user.stats?.matches || 0), 0) / 2);
  const tokens = users.reduce((sum, user) => sum + (user.balance || 0), 0);
  const vip = users.filter((user) => user.vipUntil > Date.now()).length;
  const banned = users.filter((user) => user.banUntil > Date.now()).length;
  const pending = (state.withdrawals || []).filter((row) => row.status === 'pending');
  const pendingPay = pending.reduce((sum, row) => sum + (row.payout == null ? row.amount || 0 : row.payout), 0);
  return new EmbedBuilder()
    .setTitle('OGVAULT live')
    .setColor(0xf1c40f)
    .addFields(
      { name: 'Online now', value: String(onlineCount()), inline: true },
      { name: 'Registered', value: String(users.length), inline: true },
      { name: 'VIP', value: String(vip), inline: true },
      { name: 'Open lobbies', value: String(count(['open', 'staging'])), inline: true },
      { name: 'In a match', value: String(count(['playing', 'result'])), inline: true },
      { name: 'Games played', value: String(games), inline: true },
      { name: 'Tokens in wallets', value: moneyText(tokens), inline: true },
      { name: 'Prizes paid', value: moneyText(state.prizes), inline: true },
      { name: 'Pending withdrawals', value: `${pending.length} · ${moneyText(pendingPay)}`, inline: true },
      { name: 'Banned', value: String(banned), inline: true },
    )
    .setTimestamp(new Date());
}

function biasReply(percent, updated) {
  const lead = updated ? `Dealer bias set to ${percent}%.` : `Dealer bias is ${percent}%.`;
  return `${lead} /blackjack bias with no percent shows the current value. Pass percent from 0 to 100 to change it. 0 is a fair shoe. Above 0, when the player would win, including a blackjack, the server has that chance to settle the hand for the dealer before the result is shown. At 100 it tries on every player win. The dealer still stands on 17 or more, and if a dealer win cannot be built legally the fair win stands. The cards match that settlement. Pushes stay pushes.`;
}

function readOrSetBlackjackBias(percent) {
  return update((state) => {
    if (percent == null) return { percent: blackjackBiasPercent(state), updated: false };
    return { percent: setBlackjackBias(state, percent), updated: true };
  });
}

function clearPublicChat() {
  const result = update((state) => {
    const removed = Array.isArray(state.chat) ? state.chat.length : 0;
    state.chat = [];
    return { removed };
  });
  afterChatCleared();
  return result;
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
    const role = reviewerRoleId
      ? { id: reviewerRoleId }
      : channel.guild?.roles?.cache?.find((item) => item.name === REVIEWER_ROLE_NAME);
    const content = role ? `<@&${role.id}>` : '';
    await channel.send({
      content,
      allowedMentions: role ? { roles: [role.id] } : undefined,
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
  if (!adminIds().includes(userId) && !memberHasReviewerRole(interaction)) {
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
  if (key === 'vip') {
    const user = load().users.find((entry) => entry.id === userId);
    syncGoldVip(user).catch(() => {});
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
  if (key === 'vip') {
    const user = load().users.find((entry) => entry.id === userId);
    syncGoldVip(user).catch(() => {});
  }
  await interaction.update(payload);
}

const TICKET_KINDS = {
  bug: { label: 'Report a bug', description: 'Something on the site is broken', emoji: '🐞', color: 0xed4245, category: 'Bugs' },
  withdraw: { label: 'Withdrawal', description: 'A payout has not arrived', emoji: '💳', color: 0xf1c40f, category: 'Withdrawals' },
  account: { label: 'Account issue', description: 'Login, ban, or account help', emoji: '👤', color: 0x5865f2, category: 'Account issues' },
  content: { label: 'Content creation', description: 'Apply to make content for OGVAULT', emoji: '🎬', color: 0xe84393, category: 'Content creation' },
};

const TICKET_ACCESS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];

async function ensureNamedRole(guild, name, color) {
  const existing = await roleByName(guild, name);
  if (existing) return existing;
  return guild.roles.create({ name, color, hoist: true, mentionable: true, permissions: [], reason: 'OGVAULT role' });
}

async function ticketAccessRoles(guild) {
  const helper = await ensureNamedRole(guild, 'Helper', 0xe67e22);
  const creator = await ensureNamedRole(guild, 'Content Creator', 0xe84393);
  const owner = await roleByName(guild, 'Owner');
  return { helper, creator, owner };
}

async function allowTicketStaff(channel, roles) {
  for (const role of roles) {
    if (!role) continue;
    await channel.permissionOverwrites.edit(role, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
  }
}

async function syncTicketAccess(guild) {
  const { helper, owner } = await ticketAccessRoles(guild);
  const channels = await guild.channels.fetch();
  const staff = [helper, owner].filter(Boolean);
  for (const channel of channels.values()) {
    const ticketCategories = new Set(Object.values(TICKET_KINDS).map((choice) => choice.category));
    const isTicket = ticketCategories.has(channel.name) || String(channel.topic || '').startsWith('ticket:');
    if (!isTicket) continue;
    await allowTicketStaff(channel, staff);
  }
}

async function ticketCategory(guild, kind) {
  const choice = TICKET_KINDS[kind];
  const channels = await guild.channels.fetch();
  const existing = channels.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === choice.category);
  if (existing) return existing;
  const { helper, owner } = await ticketAccessRoles(guild);
  return guild.channels.create({
    name: choice.category,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...[owner, helper].filter(Boolean).map((role) => ({ id: role.id, allow: TICKET_ACCESS })),
    ],
  });
}

function ticketModal(kind) {
  const choice = TICKET_KINDS[kind];
  const modal = new ModalBuilder().setCustomId(`ogvault:ticket:form:${kind}`).setTitle(choice.label.slice(0, 45));
  if (kind === 'content') {
    return modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('platform')
          .setLabel('What platform do you use?')
          .setPlaceholder('TikTok, YouTube, or both')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('followers')
          .setLabel('How many followers?')
          .setPlaceholder('Example: 12,000')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('profile')
          .setLabel('Link to your profile page')
          .setPlaceholder('https://')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(300),
      ),
    );
  }
  return modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('detail')
        .setLabel('Describe your issue')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('proof')
        .setLabel('Proof')
        .setPlaceholder('Clip link, screenshot link, or what you can show')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),
  );
}

async function canCloseTicket(interaction, opener) {
  if (interaction.user.id === opener || adminIds().includes(interaction.user.id)) return true;
  const owner = await roleByName(interaction.guild, 'Owner');
  const helper = await roleByName(interaction.guild, 'Helper');
  const roles = interaction.member?.roles?.cache;
  return !!roles && ((owner && roles.has(owner.id)) || (helper && roles.has(helper.id)));
}

function ticketCard({ choice, detail, proof, platform, followers, profile, account, username }) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'OGVAULT Support' })
    .setTitle(`${choice.emoji}  ${choice.label}`)
    .setColor(choice.color)
    .addFields(
      { name: 'Vault account', value: account, inline: true },
      { name: 'Opened by', value: username, inline: true },
    )
    .setFooter({ text: 'Reply in this channel. Close the ticket when it is finished.' })
    .setTimestamp(new Date());
  if (platform) {
    return embed
      .setDescription(profile || 'No profile link')
      .addFields(
        { name: 'Platform', value: platform, inline: true },
        { name: 'Followers', value: followers || '—', inline: true },
      );
  }
  return embed.setDescription(detail).addFields({ name: 'Proof', value: proof });
}

async function handleTicket(interaction, id) {
  const guild = interaction.guild;
  if (id === 'ogvault:ticket:close') {
    const opener = String(interaction.channel?.topic || '').match(/^ticket:(\d+)$/)?.[1];
    if (!opener || !(await canCloseTicket(interaction, opener))) {
      await interaction.reply({ content: 'You cannot close this ticket.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Ticket closed.' });
    await interaction.channel.delete('Ticket closed').catch(() => {});
    return;
  }
  const kind = id.split(':').pop();
  const choice = TICKET_KINDS[kind];
  if (!choice) {
    await interaction.reply({ content: 'Pick one of the issues in the list.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const channels = await guild.channels.fetch();
  const topic = `ticket:${interaction.user.id}`;
  const existing = channels.find((channel) => channel.topic === topic);
  if (existing) {
    const category = await ticketCategory(guild, kind);
    if (existing.parentId !== category.id) await existing.setParent(category.id, { lockPermissions: false });
    await interaction.editReply({ content: `You already have a ticket: ${existing}` });
    return;
  }
  const { helper, owner } = await ticketAccessRoles(guild);
  const category = await ticketCategory(guild, kind);
  const slug = String(interaction.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
  const detail = kind === 'content' ? '' : interaction.fields.getTextInputValue('detail').slice(0, 1000);
  const proof = kind === 'content' ? '' : interaction.fields.getTextInputValue('proof').slice(0, 1000);
  const platform = kind === 'content' ? interaction.fields.getTextInputValue('platform').slice(0, 100) : '';
  const followers = kind === 'content' ? interaction.fields.getTextInputValue('followers').slice(0, 100) : '';
  const profile = kind === 'content' ? interaction.fields.getTextInputValue('profile').slice(0, 300) : '';
  const linked = load().users?.find((user) => !user.npc && String(user.discordId || '') === interaction.user.id);
  const channel = await guild.channels.create({
    name: `ticket-${slug}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: TICKET_ACCESS },
      ...[owner, helper].filter(Boolean).map((role) => ({ id: role.id, allow: TICKET_ACCESS })),
    ],
  });
  if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false });
  await channel.send({
    content: `${interaction.user}`,
    embeds: [
      ticketCard({
        choice,
        detail,
        proof,
        platform,
        followers,
        profile,
        account: linked?.username || 'Not linked',
        username: interaction.user.username,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ogvault:ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
  await interaction.editReply({ content: `Ticket opened: ${channel}` });
}

async function roleByName(guild, name) {
  const roles = await guild.roles.fetch();
  return roles.find((role) => role.name === name) || null;
}

async function handleCommunityButton(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Use that in the server.', ephemeral: true });
    return;
  }
  const id = String(interaction.customId || '');
  if (id === 'ogvault:ticket:close') {
    try {
      await handleTicket(interaction, id);
    } catch (error) {
      const content = error?.status ? error.message : 'Could not open that ticket. The bot needs Manage Channels.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (id === 'ogvault:verify') {
    const linked = load().users?.find((user) => !user.npc && String(user.discordId || '') === interaction.user.id);
    if (!linked) {
      await interaction.reply({
        content: 'Sign in with Discord on https://ogvault.co.uk first, then press this again.',
        ephemeral: true,
      });
      return;
    }
    const memberRole = await roleByName(guild, 'Member');
    if (!memberRole) {
      await interaction.reply({ content: 'The Member role is missing.', ephemeral: true });
      return;
    }
    await interaction.member.roles.add(memberRole);
    syncGoldVip(linked).catch(() => {});
    await interaction.reply({
      content: `Linked as ${linked.username}. You can talk in the member channels now.`,
      ephemeral: true,
    });
    return;
  }
  if (id === 'ogvault:region:na' || id === 'ogvault:region:eu') {
    const pick = id.endsWith(':na') ? 'NA' : 'EU';
    const other = pick === 'NA' ? 'EU' : 'NA';
    const chosen = await roleByName(guild, pick);
    const previous = await roleByName(guild, other);
    if (!chosen) {
      await interaction.reply({ content: 'That region role is missing.', ephemeral: true });
      return;
    }
    if (previous) await interaction.member.roles.remove(previous).catch(() => {});
    await interaction.member.roles.add(chosen);
    await interaction.reply({ content: `Region set to ${pick}.`, ephemeral: true });
  }
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
    if (interaction.commandName === 'clearchat') {
      const result = clearPublicChat();
      const count = result.removed;
      await interaction.reply({
        content: `Cleared ${count} public Live Chat message${count === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'purge') {
      await interaction.deferReply({ ephemeral: true });
      const removed = await purgeChannel(interaction.channel);
      await interaction.editReply({ content: `Deleted ${removed} message${removed === 1 ? '' : 's'} in this channel.` });
      return;
    }
    if (interaction.commandName === 'blackjack' && interaction.options.getSubcommand() === 'bias') {
      const result = readOrSetBlackjackBias(interaction.options.getInteger('percent'));
      await interaction.reply({ content: biasReply(result.percent, result.updated), ephemeral: true });
      return;
    }
    if (interaction.commandName === 'stats') {
      await interaction.reply({ embeds: [siteStatsEmbed()], ephemeral: true });
      return;
    }
    if (interaction.commandName === 'give') {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (!user || role.managed || role.id === interaction.guildId) {
        await interaction.reply({ content: 'Pick a member and a normal role.', ephemeral: true });
        return;
      }
      const botMember = await interaction.guild.members.fetchMe();
      if (role.position >= botMember.roles.highest.position) {
        await interaction.reply({ content: 'Move the bot role above that role, then try again.', ephemeral: true });
        return;
      }
      await interaction.guild.members.addRole({ user: user.id, role, reason: 'OGVAULT /give' });
      if (role.name === 'Helper') await syncTicketAccess(interaction.guild);
      await interaction.reply({ content: `${user.username} now has ${role.name}.`, ephemeral: true });
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
    if (interaction.commandName === 'website') {
      const result = setWebsite(
        interaction.options.getString('status'),
        interaction.options.getString('reason'),
        interaction.options.getInteger('length'),
        interaction.options.getString('unit'),
      );
      applyBotStatus();
      const label = result.reason === 'repair' ? 'repair' : 'maintenance';
      await interaction.reply({
        content: result.online
          ? 'The site is online.'
          : result.until
            ? `The site is offline for ${label} until <t:${Math.floor(result.until / 1000)}:R>.`
            : `The site is offline for ${label}.`,
        ephemeral: true,
      });
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
      const itemKey = sub === 'tokens' ? '' : interaction.options.getString('item');
      const result = sub === 'tokens' ? giveAllTokens(interaction.options.getNumber('amount')) : giveAllItem(itemKey);
      if (itemKey === 'vip') sweepGoldVip().catch(() => {});
      await interaction.reply({
        content: `Updated ${result.updated} user${result.updated === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'withdrawals' && interaction.options.getSubcommand() === 'list') {
      await interaction.reply({ content: listWithdrawals(), ephemeral: true });
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

const WITHDRAW_CHANNELS = {
  crypto: 'DISCORD_WITHDRAW_CRYPTO_CHANNEL_ID',
  paypal: 'DISCORD_WITHDRAW_PAYPAL_CHANNEL_ID',
  bank: 'DISCORD_WITHDRAW_BANK_CHANNEL_ID',
};

function destinationText(method, destination) {
  const dest = destination || {};
  if (method === 'paypal') return dest.email || '—';
  if (method === 'crypto') return `${dest.network || 'Crypto'}\n${dest.address || '—'}`;
  return `${dest.accountName || '—'}\n${dest.accountNumber || '—'} · ${dest.sortCode || '—'}`;
}

export async function notifyWithdrawal({ username, method, amount, fee, payout, destination }) {
  if (!bot || botFailed) return;
  const key = WITHDRAW_CHANNELS[String(method || '').toLowerCase()];
  const channelId = String((key && process.env[key]) || '').trim();
  if (!/^\d{5,32}$/.test(channelId)) return;
  const embed = new EmbedBuilder()
    .setTitle(`${method} withdrawal`)
    .setColor(0x7aa2ff)
    .addFields(
      { name: 'Player', value: username || 'Unknown', inline: true },
      { name: 'Amount', value: String(amount), inline: true },
      { name: 'Fee', value: String(fee), inline: true },
      { name: 'Pay out', value: String(payout), inline: true },
      { name: 'Send to', value: destinationText(method, destination) },
    );
  const methodName = String(method || '').toLowerCase();
  const row = new ActionRowBuilder();
  if (methodName === 'crypto') {
    row.addComponents(new ButtonBuilder().setCustomId('ogcopy:crypto').setLabel('Copy address').setStyle(ButtonStyle.Secondary));
  } else if (methodName === 'paypal') {
    row.addComponents(new ButtonBuilder().setCustomId('ogcopy:paypal').setLabel('Copy email').setStyle(ButtonStyle.Secondary));
  }
  try {
    const channel = await bot.channels.fetch(channelId);
    await channel.send({ embeds: [embed], components: row.components.length ? [row] : [] });
  } catch {
    console.error('Could not post a withdrawal alert');
  }
}

function copyValueFromEmbed(interaction) {
  const field = interaction.message?.embeds?.[0]?.fields?.find((item) => item.name === 'Send to');
  const lines = String(field?.value || '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('TEST'));
  if (interaction.customId === 'ogcopy:paypal') return lines.find((line) => line.includes('@')) || '';
  return lines.find((line) => !['Solana', 'Ethereum', 'Bitcoin'].includes(line)) || '';
}

export async function handleCopyWithdrawal(interaction) {
  const value = copyValueFromEmbed(interaction);
  if (!value) {
    await interaction.reply({ content: 'Nothing to copy on that alert.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: `\`${value}\``, ephemeral: true });
}

export async function notifyPayment({ method, username, tokens, amount, status, reference }) {
  if (!bot || botFailed) return;
  const channelId = String(process.env.DISCORD_PAYMENTS_CHANNEL_ID || '').trim();
  if (!/^\d{5,32}$/.test(channelId)) return;
  const paid = status === 'paid' || status === 'finished';
  const embed = new EmbedBuilder()
    .setTitle(paid ? `${method} payment received` : `${method} payment ${status || 'update'}`)
    .setColor(paid ? 0x3ddc84 : 0xe2b340)
    .addFields(
      { name: 'Player', value: username || 'Unknown', inline: true },
      { name: 'Tokens', value: String(tokens ?? 0), inline: true },
      { name: 'Amount', value: amount || '—', inline: true },
      { name: 'Reference', value: reference || '—' },
    );
  try {
    const channel = await bot.channels.fetch(channelId);
    await channel.send({ embeds: [embed] });
  } catch {
    console.error('Could not post a payment alert');
  }
}

const COMMAND_GUIDE = [
  ['/balance', 'Show a site user token balance.'],
  ['/ban', 'Ban a site account from login and matchmaking for a number of hours.'],
  ['/unban', 'Clear a site ban so the player can sign in again.'],
  ['/blackjack bias', 'Show or set how often a player win is settled for the dealer. 0 is fair, 100 is the maximum edge.'],
  ['/clearchat', 'Clear the site public Live Chat. This does not clear Discord or match chat.'],
  ['/give', 'Give any Discord role to a member, including Helper, Reviewer, and Content Creator.'],
  ['/giveall tokens', 'Credit tokens to every registered user.'],
  ['/giveall item', 'Grant an inventory item to every registered user.'],
  ['/inventory', 'Show a site user inventory and add or remove items.'],
  ['/matchmaking', 'Turn new Kill Race listings on or off, with an optional number of hours.'],
  ['/purge', 'Delete every message in the Discord channel where you run it.'],
  ['/stats', 'Show live players, registered users, open lobbies, games, tokens, and withdrawals.'],
  ['/tokens add', 'Add tokens to one site account.'],
  ['/tokens remove', 'Remove tokens from one site account.'],
  ['/tournament create', 'Open a cup on the site with a name, player cap, entry, hours, and prizes.'],
  ['/website', 'Take the whole site offline for repair or maintenance, with an optional countdown, or bring it back online.'],
  ['/withdrawals list', 'List pending token withdrawal requests.'],
];

function commandGuideEmbeds() {
  const lines = COMMAND_GUIDE.map(([name, text]) => `**${name}**\n${text}`);
  const groups = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 2 > 1000 && current.length) {
      groups.push(current.join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 2;
  }
  if (current.length) groups.push(current.join('\n\n'));
  const [first, ...rest] = groups;
  return [
    new EmbedBuilder()
      .setTitle('Command list')
      .setColor(0xf1c40f)
      .setDescription('Slash commands are limited to **Owner**.')
      .addFields({ name: 'Owner', value: first }),
    new EmbedBuilder()
      .setColor(0xf1c40f)
      .setDescription(rest.join('\n\n') || '—')
      .addFields(
        { name: 'Reviewer', value: 'Can press the award buttons on a clip-review message. No slash commands.' },
        { name: 'Helper', value: 'Can see support tickets, reply in them, and close them. No slash commands.' },
        { name: 'Content Creator', value: 'Display role only. No commands.' },
        { name: 'Member', value: 'Can talk in general, clips, and the community channels after linking a vault account. No slash commands.' },
        { name: 'Everyone', value: 'Can read the start-here channels, link a vault account, pick NA or EU, and open a support ticket.' },
      ),
  ];
}

async function publishCommandGuide(guild) {
  const channels = await guild.channels.fetch();
  const staff = channels.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === 'Staff');
  let channel = channels.find((item) => item.type === ChannelType.GuildText && item.name === 'command-list');
  if (!channel) {
    channel = await guild.channels.create({
      name: 'command-list',
      type: ChannelType.GuildText,
      parent: staff?.id,
      topic: 'What each bot command does, and who can use it.',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });
  }
  const embeds = commandGuideEmbeds();
  const recent = await channel.messages.fetch({ limit: 10 });
  const existing = recent.find((message) => message.author.id === guild.client.user.id && message.embeds[0]?.title === 'Command list');
  if (existing) await existing.edit({ embeds });
  else await channel.send({ embeds });
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
      await ensureReviewerRole(await client.guilds.fetch(guildId));
      await ensureGoldVipRole(await client.guilds.fetch(guildId));
      await sweepGoldVip();
      setInterval(() => { sweepGoldVip().catch(() => {}); }, 15 * 60 * 1000);
      await syncTicketAccess(await client.guilds.fetch(guildId));
      for (const kind of Object.keys(TICKET_KINDS)) {
        await ticketCategory(await client.guilds.fetch(guildId), kind);
      }
      await publishCommandGuide(await client.guilds.fetch(guildId));
      applyBotStatus();
      console.log('Reviewer role can read message history');
    } catch (error) {
      console.error('Discord slash command registration failed', error.status || '');
    }
  });
  client.on('interactionCreate', (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ogvault:ticket:pick') {
      const kind = interaction.values?.[0];
      if (!TICKET_KINDS[kind]) {
        interaction.reply({ content: 'Pick one of the issues in the list.', ephemeral: true }).catch(() => {});
        return;
      }
      interaction.showModal(ticketModal(kind)).catch(() => {});
      return;
    }
    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('ogvault:ticket:form:')) {
      handleTicket(interaction, interaction.customId).catch(async (error) => {
        const content = error?.status ? error.message : 'Could not open that ticket. The bot needs Manage Channels.';
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
        else await interaction.reply({ content, ephemeral: true }).catch(() => {});
      });
      return;
    }
    if (interaction.isButton() && String(interaction.customId || '').startsWith('ogvault:')) {
      handleCommunityButton(interaction).catch(() => {});
      return;
    }
    if (interaction.isButton() && String(interaction.customId || '').startsWith('ogcopy:')) {
      handleCopyWithdrawal(interaction).catch(() => {});
      return;
    }
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
