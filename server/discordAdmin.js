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
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { disputeReviewChannelId } from './discord.js';
import crypto from 'crypto';
import {
  INVENTORY_GRANTS,
  credit,
  debit,
  ensurePotw,
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
    .setName('account')
    .setDescription('Look up, reset, or delete a site account')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('Show email, balance, and when the account was created')
        .addStringOption((option) =>
          option.setName('username').setDescription('Site username, email, or Discord username').setRequired(true).setMaxLength(80)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Set a new password when they forgot the old one')
        .addStringOption((option) =>
          option.setName('username').setDescription('Site username, email, or Discord username').setRequired(true).setMaxLength(80)
        )
        .addStringOption((option) =>
          option.setName('password').setDescription('New password, 8–25 characters with a letter and a number').setRequired(true).setMinLength(8).setMaxLength(25)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete the site account')
        .addStringOption((option) =>
          option.setName('username').setDescription('Site username, email, or Discord username').setRequired(true).setMaxLength(80)
        )
    )),
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
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show your OGVAULT tokens and Vault Points')
    .addStringOption((option) =>
      option.setName('username').setDescription('Owner only: look up another player').setRequired(false).setMaxLength(64)
    ),
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a member to the Helpers')
    .addUserOption((option) => option.setName('user').setDescription('Member to report (pick them or paste their ID)').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('How to earn free tokens with your Discord status'),
  adminOnly(new SlashCommandBuilder()
    .setName('live')
    .setDescription('Lock the site behind a launch page until the Discord reaches a member goal')
    .addStringOption((option) =>
      option.setName('status').setDescription('Turn the launch page on or off').setRequired(true)
        .addChoices({ name: 'On: lock the site until the goal', value: 'on' }, { name: 'Off: open the site now', value: 'off' })
    )
    .addIntegerOption((option) =>
      option.setName('goal').setDescription('Member goal, for example 500').setMinValue(1).setMaxValue(1000000)
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('match')
    .setDescription('Owner match tools')
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Every match a player has played, with entry, opponent and winner')
        .addStringOption((option) =>
          option.setName('user').setDescription('Site username or Discord username').setRequired(true).setMaxLength(64)
        )
    )),
  adminOnly(new SlashCommandBuilder()
    .setName('check')
    .setDescription('Owner checks')
    .addSubcommand((sub) => sub.setName('rate').setDescription('Live count of members with the OGVAULT status'))),
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
    state.users.find((user) => !user.npc && String(user.email || '').toLowerCase() === query) ||
    state.users.find((user) => !user.npc && String(user.discordUsername || '').toLowerCase() === query) ||
    null
  );
}

function hashPw(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function registeredAccount(user) {
  if (!user) fail(404, 'No player by that name');
  return user;
}

function matchHistoryPayload(query) {
  const state = load();
  const user = registeredAccount(findAccount(state, query));
  const nameOf = (id) => state.users.find((item) => item.id === id)?.username || (id ? 'deleted player' : '—');
  const rows = [];
  const seen = new Set();
  for (const match of state.matches || []) {
    if (match.practice || !match.guestId || (match.hostId !== user.id && match.guestId !== user.id)) continue;
    seen.add(match.id);
    rows.push({
      id: match.id,
      at: match.startAt || match.createdAt || 0,
      entry: match.entry,
      currency: match.currency || 'tokens',
      opponent: nameOf(match.hostId === user.id ? match.guestId : match.hostId),
      side: match.hostId === user.id ? 'host' : 'guest',
      status: match.status,
      winnerId: match.winnerId,
      payout: match.payout,
      project: match.project,
      region: match.region,
      forfeit: !!match.forfeitId,
      awardedBy: match.awardedBy?.name || '',
    });
  }
  for (const row of state.history || []) {
    if (seen.has(row.id) || row.practice) continue;
    const me = (row.players || []).find((item) => item.id === user.id);
    if (!me) continue;
    const other = (row.players || []).find((item) => item.id !== user.id);
    rows.push({
      id: row.id,
      at: row.at,
      entry: row.entry,
      currency: row.currency || 'tokens',
      opponent: other?.username || '—',
      side: '',
      status: 'done',
      winnerId: row.winnerId,
      payout: row.payout,
      project: row.project,
      region: '',
      forfeit: !!row.forfeit,
      awardedBy: '',
    });
  }
  rows.sort((a, b) => b.at - a.at);
  const unit = (row) => (row.currency === 'points' ? 'pts' : 'tokens');
  let wins = 0;
  let losses = 0;
  let wagered = 0;
  for (const row of rows) {
    if (row.status !== 'done') continue;
    if (row.currency !== 'points') wagered += Number(row.entry) || 0;
    if (row.winnerId === user.id) wins += 1;
    else if (row.winnerId) losses += 1;
  }
  const lines = [];
  for (const row of rows.slice(0, 25)) {
    let result;
    if (row.status !== 'done') result = `⏳ ${row.status}`;
    else if (!row.winnerId) result = '➖ Draw';
    else if (row.winnerId === user.id) result = `✅ **Won** +${row.payout || 0} ${unit(row)}`;
    else result = `❌ **Lost** (${nameOf(row.winnerId)} won)`;
    const extra = [row.forfeit ? 'forfeit' : '', row.awardedBy ? `awarded by ${row.awardedBy}` : ''].filter(Boolean).join(', ');
    const when = row.at ? `<t:${Math.floor(row.at / 1000)}:d>` : '';
    lines.push(
      `${when} vs **${row.opponent}** · ${row.entry} ${unit(row)} entry · ${[row.project, row.region].filter(Boolean).join(' ')}\n` +
      `${result}${extra ? ` · ${extra}` : ''} · \`${row.id}\``
    );
  }
  let description = lines.join('\n\n') || 'No matches played yet.';
  if (description.length > 4000) description = `${description.slice(0, 3990)}…`;
  return {
    embeds: [{
      title: `Match history · ${user.username}`,
      color: 0x2f6bff,
      description,
      fields: [
        { name: 'Played', value: String(rows.filter((row) => row.status === 'done').length), inline: true },
        { name: 'Record', value: `${wins}W / ${losses}L`, inline: true },
        { name: 'Tokens wagered', value: String(round(wagered)), inline: true },
      ],
      footer: { text: rows.length > 25 ? `Showing the latest 25 of ${rows.length}` : `${rows.length} match${rows.length === 1 ? '' : 'es'}` },
    }],
  };
}

function accountDetails(user) {
  const created = user.createdAt ? `<t:${Math.floor(user.createdAt / 1000)}:f>` : 'Unknown';
  return [
    `**Username** ${user.username}`,
    `**Email** ${user.email || 'None'}`,
    user.password
      ? '**Password** Saved as a hash, so the original cannot be shown. Use `/account reset` to set a new one.'
      : '**Password** None. This account signs in with Discord.',
    `**Balance** ${round(user.balance || 0)} tokens`,
    `**Created** ${created}`,
    `**VIP** ${isVip(user) ? 'Active' : 'No'}`,
    `**Discord** ${user.discordUsername ? `@${user.discordUsername}` : 'Not linked'}`,
  ].join('\n');
}

function openMatch(state, userId) {
  return (state.matches || []).find((match) => (
    match.status !== 'done' && (match.hostId === userId || match.guestId === userId)
  ));
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
  return { username: user.username, balance: round(user.balance), points: Math.round(user.points || 0) };
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

function setLaunchGate(status, goal) {
  return update((state) => {
    const gate = state.launchGate || {};
    if (status === 'off') {
      state.launchGate = { ...gate, enabled: false };
      return state.launchGate;
    }
    const target = Number(goal ?? gate.goal);
    if (!Number.isInteger(target) || target < 1) fail(400, 'Set a member goal, for example 500');
    state.launchGate = { ...gate, enabled: true, goal: target };
    return state.launchGate;
  });
}

async function countHumans(guild) {
  const fresh = await guild.fetch();
  const roles = await guild.roles.fetch();
  const bots = new Set(roles.filter((role) => role.tags?.botId).map((role) => role.tags.botId)).size;
  const total = fresh.approximateMemberCount ?? fresh.memberCount ?? 0;
  return Math.max(0, total - bots);
}

async function launchInvite(guild) {
  const saved = load().launchGate?.invite;
  if (saved) return saved;
  const channels = await guild.channels.fetch();
  const channel =
    guild.systemChannel ||
    channels.find((item) => item?.type === ChannelType.GuildText && /welcome/i.test(item.name)) ||
    channels.find((item) => item?.type === ChannelType.GuildText);
  if (!channel) return '';
  const invite = await guild.invites.create(channel.id, { maxAge: 0, maxUses: 0, unique: false, reason: 'OGVAULT launch page' });
  return invite.url;
}

async function tickLaunch() {
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!bot?.isReady() || !guildId) return;
  const guild = await bot.guilds.fetch(guildId);
  const members = await countHumans(guild);
  const invite = await launchInvite(guild).catch(() => '');
  const gate = load().launchGate || {};
  const reached = gate.enabled && gate.goal > 0 && members >= gate.goal;
  if (gate.members === members && (gate.invite || '') === (invite || gate.invite || '') && !reached) return;
  update((state) => {
    state.launchGate = { ...(state.launchGate || {}), members, membersAt: Date.now(), invite: invite || state.launchGate?.invite || '' };
    if (reached) {
      state.launchGate.enabled = false;
      state.launchGate.liveAt = Date.now();
    }
  });
  if (reached) {
    const channels = await guild.channels.fetch();
    const news = channels.find((item) => item?.type === ChannelType.GuildText && /announcements/i.test(item.name));
    await news?.send({
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
      embeds: [new EmbedBuilder()
        .setTitle('🎉  OGVAULT is LIVE!')
        .setColor(0xf5c542)
        .setDescription(`We hit **${members}/${gate.goal}** members. Thank you! The site is open now: https://ogvault.co.uk`)],
    }).catch(() => {});
  }
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

export function clearPublicChat() {
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
  let awarded = null;
  try {
    awarded = update((state) => {
      const match = state.matches.find((item) => item.id === matchId);
      if (!match) return null;
      const nameOf = (id) => state.users.find((item) => item.id === id)?.username || 'player';
      if (match.status === 'done') {
        return match.winnerId ? { winner: nameOf(match.winnerId), by: match.awardedBy?.name || '' } : null;
      }
      const winnerId = side === 'host' ? match.hostId : match.guestId;
      settleAgreed(state, match, winnerId);
      match.awardedBy = { discordId: userId, name: interaction.user.username, at: Date.now() };
      if (match.review) {
        match.review.host = '';
        match.review.guest = '';
      }
      settled = true;
      return { winner: nameOf(winnerId), by: interaction.user.username };
    });
  } catch (error) {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: error.status ? error.message : 'That award failed', ephemeral: true });
    return;
  }
  const embeds = (interaction.message.embeds || []).map((embed) => embed.toJSON());
  if (awarded && embeds[0]) {
    const fields = (embeds[0].fields || []).filter((field) => field.name !== '🏆 Awarded');
    const by = awarded.by ? ` by ${awarded.by}` : '';
    fields.push({ name: '🏆 Awarded', value: `**${awarded.winner}** won${by} · <t:${Math.floor(Date.now() / 1000)}:R>`.slice(0, 1024), inline: false });
    embeds[0] = { ...embeds[0], fields, color: 0x2ecc71 };
  }
  await interaction.update({ embeds, components: freezeAwardButtons(interaction.message.components) });
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
  staff: { label: 'Staff application', description: 'Apply to be a Reviewer or Helper', emoji: '🛡️', color: 0x2ecc71, category: 'Staff applications' },
};

const STAFF_ROLES = {
  reviewer: { name: 'Reviewer', duty: 'Watch match clips and award disputed wins fairly.' },
  helper: { name: 'Helper', duty: 'Answer tickets, help players, and moderate chat and voice.' },
};

function staffRolePicker() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🛡️  Staff application')
      .setColor(TICKET_KINDS.staff.color)
      .setDescription('Which role are you applying for?')
      .addFields(Object.values(STAFF_ROLES).map((role) => ({ name: role.name, value: role.duty })))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ogvault:staffapp:reviewer').setLabel('Reviewer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ogvault:staffapp:helper').setLabel('Helper').setStyle(ButtonStyle.Success),
    )],
    ephemeral: true,
  };
}

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

function ticketModal(kind, staffRole = '') {
  const choice = TICKET_KINDS[kind];
  if (kind === 'staff') {
    const role = STAFF_ROLES[staffRole];
    const input = (id, label, style, placeholder, max) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(true).setMaxLength(max),
      );
    return new ModalBuilder()
      .setCustomId(`ogvault:ticket:form:staff:${staffRole}`)
      .setTitle(`${role.name} application`.slice(0, 45))
      .addComponents(
        input('age', 'How old are you?', TextInputStyle.Short, 'Example: 18', 10),
        input('availability', 'Time zone and hours you can help', TextInputStyle.Short, 'Example: GMT, evenings and weekends', 150),
        input('experience', 'Past staff or moderation experience', TextInputStyle.Paragraph, 'Servers, roles, how long', 1000),
        input('why', `Why should you be a ${role.name}?`, TextInputStyle.Paragraph, 'Tell us about yourself', 1000),
      );
  }
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

function ticketCard({ choice, detail, proof, platform, followers, profile, account, username, staff }) {
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
  if (staff) {
    return embed
      .setTitle(`${choice.emoji}  ${staff.role} application`)
      .setDescription(staff.why)
      .addFields(
        { name: 'Applying for', value: `**${staff.role}**`, inline: true },
        { name: 'Age', value: staff.age, inline: true },
        { name: 'Availability', value: staff.availability },
        { name: 'Experience', value: staff.experience },
      );
  }
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
    const opener = String(interaction.channel?.topic || '').match(/^ticket:(\d+)(?::staff)?$/)?.[1];
    if (!opener || !(await canCloseTicket(interaction, opener))) {
      await interaction.reply({ content: 'You cannot close this ticket.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Ticket closed.' });
    await interaction.channel.delete('Ticket closed').catch(() => {});
    return;
  }
  const [, , , kind, staffKey] = id.split(':');
  const choice = TICKET_KINDS[kind];
  const staffRole = kind === 'staff' ? STAFF_ROLES[staffKey] : null;
  if (!choice || (kind === 'staff' && !staffRole)) {
    await interaction.reply({ content: 'Pick one of the issues in the list.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const channels = await guild.channels.fetch();
  const topic = kind === 'staff' ? `ticket:${interaction.user.id}:staff` : `ticket:${interaction.user.id}`;
  const existing = channels.find((channel) => channel.topic === topic);
  if (existing && kind === 'staff') {
    await interaction.editReply({ content: `You already have a staff application open: ${existing}` });
    return;
  }
  if (existing) {
    const category = await ticketCategory(guild, kind);
    if (existing.parentId !== category.id) await existing.setParent(category.id, { lockPermissions: false });
    await interaction.editReply({ content: `You already have a ticket: ${existing}` });
    return;
  }
  const { helper, owner } = await ticketAccessRoles(guild);
  const category = await ticketCategory(guild, kind);
  const slug = String(interaction.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
  const field = (name, max) => interaction.fields.getTextInputValue(name).slice(0, max) || '—';
  const staff = staffRole
    ? { role: staffRole.name, age: field('age', 10), availability: field('availability', 150), experience: field('experience', 1000), why: field('why', 1000) }
    : null;
  const plain = kind !== 'content' && !staff;
  const detail = plain ? interaction.fields.getTextInputValue('detail').slice(0, 1000) : '';
  const proof = plain ? interaction.fields.getTextInputValue('proof').slice(0, 1000) : '';
  const platform = kind === 'content' ? interaction.fields.getTextInputValue('platform').slice(0, 100) : '';
  const followers = kind === 'content' ? interaction.fields.getTextInputValue('followers').slice(0, 100) : '';
  const profile = kind === 'content' ? interaction.fields.getTextInputValue('profile').slice(0, 300) : '';
  const linked = load().users?.find((user) => !user.npc && String(user.discordId || '') === interaction.user.id);
  const channel = await guild.channels.create({
    name: staff ? `apply-${staffKey}-${slug}` : `ticket-${slug}`,
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
        staff,
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
  if (id === 'ogvault:verify:password') {
    await interaction.showModal(passwordLinkModal());
    return;
  }
  if (id === 'ogvault:verify') {
    const linked = load().users?.find((user) => !user.npc && String(user.discordId || '') === interaction.user.id);
    if (!linked) {
      await interaction.reply({
        content: 'Sign in with Discord on https://ogvault.co.uk first, then press this again. Registered with an email instead? Press **Link with password**.',
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

const STATUS_RATE = 0.02;
const STATUS_NEED_MS = 60 * 60 * 1000;
const STATUS_TICK_MS = 5 * 60 * 1000;
let presenceEnabled = false;

function statusKeywords() {
  const extra = String(process.env.STATUS_KEYWORDS || '').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean);
  return ['ogvault.co.uk', ...extra];
}

function customStatus(presence) {
  const activity = (presence?.activities || []).find((item) => item.type === ActivityType.Custom);
  return String(activity?.state || '');
}

function showsStatus(presence) {
  if (!presence || presence.status === 'offline') return false;
  const text = customStatus(presence).toLowerCase();
  return statusKeywords().some((word) => text.includes(word));
}

function statusGuild() {
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  return bot?.guilds?.cache?.get(guildId) || null;
}

function liveStatusIds() {
  const guild = statusGuild();
  if (!guild) return [];
  return [...guild.presences.cache.values()].filter(showsStatus).map((presence) => presence.userId);
}

function statusDay() {
  return new Date().toISOString().slice(0, 10);
}

function tickStatusRewards() {
  const ids = new Set(liveStatusIds());
  if (!ids.size) return;
  const day = statusDay();
  const now = Date.now();
  update((state) => {
    for (const user of state.users) {
      if (user.npc || !user.discordId || !ids.has(user.discordId)) continue;
      if (user.banUntil > now) continue;
      if (user.vpnLastAt && now - user.vpnLastAt < 24 * 60 * 60 * 1000) continue;
      if (user.statusDay !== day) {
        user.statusDay = day;
        user.statusMs = 0;
      }
      user.statusMs = (user.statusMs || 0) + STATUS_TICK_MS;
      if (user.statusMs >= STATUS_NEED_MS && user.statusPaidDay !== day) {
        credit(state, user, STATUS_RATE, 'status', { note: 'discord-status' });
        user.statusPaidDay = day;
      }
    }
  });
}

async function replyStatusRate(interaction) {
  if (!presenceEnabled) {
    await interaction.reply({
      content: 'Status tracking is off. Turn on **Presence Intent** for the bot in the Discord Developer Portal, then restart the API.',
      ephemeral: true,
    });
    return;
  }
  const ids = liveStatusIds();
  const state = load();
  const day = statusDay();
  const linked = ids.map((id) => state.users.find((user) => !user.npc && user.discordId === id)).filter(Boolean);
  const paidToday = state.users.filter((user) => user.statusPaidDay === day).length;
  const mine = statusGuild()?.presences.cache.get(interaction.user.id);
  const names = ids.slice(0, 25).map((id) => {
    const user = state.users.find((item) => !item.npc && item.discordId === id);
    return user ? `• ${user.username}` : `• <@${id}> (not linked)`;
  });
  await interaction.reply({
    content: [
      `**Live now** ${ids.length} member${ids.length === 1 ? '' : 's'} showing the status (${linked.length} linked to a site account)`,
      `**Your status** ${showsStatus(mine) ? 'Detected ✅' : `Not detected${mine ? ` (currently: "${customStatus(mine) || 'none'}", ${mine.status})` : ' (offline or invisible)'}`}`,
      `**Paid today** ${paidToday} · rate ${STATUS_RATE} tokens a day after 1 hour with the status`,
      names.length ? names.join('\n') : '',
    ].filter(Boolean).join('\n'),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function replyOwnBalance(interaction) {
  const user = load().users.find((item) => !item.npc && item.discordId === interaction.user.id);
  if (!user) {
    await interaction.reply({ content: 'Your Discord is not linked to an OGVAULT account yet. Sign in at https://ogvault.co.uk with Discord.', ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `**${user.username}**\nTokens: ${Number(round(user.balance || 0)).toFixed(2)}\nVault Points: ${Math.round(user.points || 0)}`,
    ephemeral: true,
  });
}

async function replyEarn(interaction) {
  const user = load().users.find((item) => !item.npc && item.discordId === interaction.user.id);
  const presence = statusGuild()?.presences.cache.get(interaction.user.id);
  const live = showsStatus(presence);
  const paid = user?.statusPaidDay === statusDay();
  const minutes = user?.statusDay === statusDay() ? Math.floor((user.statusMs || 0) / 60000) : 0;
  const embed = new EmbedBuilder()
    .setColor(0xf5c451)
    .setTitle(`Earn ${STATUS_RATE} tokens a day`)
    .setDescription([
      'Put **`ogvault.co.uk`** in your Discord custom status and keep it there for 1 hour.',
      '',
      '**Where it goes**',
      '1. Click your profile picture in the bottom left of Discord.',
      '2. Click **Set Custom Status** (or **Edit Custom Status**).',
      '3. Type `ogvault.co.uk` and set **Clear after** to **Don\'t clear**.',
      '4. Stay **Online**, **Idle** or **Do Not Disturb**. Invisible does not count.',
      '',
      '**Rules**',
      '• Your Discord must be linked to your OGVAULT account. Sign in with Discord at https://ogvault.co.uk',
      '• You must stay in this server.',
      `• Pays ${STATUS_RATE} tokens once per day (resets at midnight UTC).`,
    ].join('\n'))
    .addFields(
      { name: 'Account', value: user ? `Linked as ${user.username}` : 'Not linked yet', inline: true },
      { name: 'Your status', value: live ? 'Detected ✅' : 'Not detected', inline: true },
      { name: 'Today', value: paid ? 'Paid ✅' : `${Math.min(minutes, 60)} / 60 minutes`, inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

const LINK_TRIES = 5;
const LINK_WINDOW_MS = 15 * 60 * 1000;
const linkTries = new Map();

function passwordLinkModal() {
  return new ModalBuilder()
    .setCustomId('ogvault:link:form')
    .setTitle('Link your OGVAULT account')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('login')
          .setLabel('Email or username')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('password')
          .setLabel('Password')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(64),
      ),
    );
}

function passwordMatches(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  return prev.length === next.length && crypto.timingSafeEqual(prev, next);
}

async function handlePasswordLink(interaction) {
  const now = Date.now();
  const tries = (linkTries.get(interaction.user.id) || []).filter((at) => now - at < LINK_WINDOW_MS);
  if (tries.length >= LINK_TRIES) {
    await interaction.reply({ content: 'Too many attempts. Try again in 15 minutes.', ephemeral: true });
    return;
  }
  tries.push(now);
  linkTries.set(interaction.user.id, tries);
  const login = interaction.fields.getTextInputValue('login').trim().toLowerCase();
  const password = interaction.fields.getTextInputValue('password');
  let linked;
  try {
    linked = update((state) => {
      const user = state.users.find((item) => !item.npc && (String(item.email || '').toLowerCase() === login || item.username.toLowerCase() === login));
      if (!user || !user.password || !passwordMatches(password, user.password)) fail(401, 'Email/username or password is wrong.');
      if (user.banUntil > Date.now()) fail(403, 'This account is banned.');
      if (user.discordId && user.discordId !== interaction.user.id) fail(409, 'That account is already linked to a different Discord. Open a support ticket if this is wrong.');
      const other = state.users.find((item) => !item.npc && item.id !== user.id && item.discordId === interaction.user.id);
      if (other) fail(409, `This Discord is already linked to ${other.username}.`);
      user.discordId = interaction.user.id;
      user.discordUsername = interaction.user.username;
      user.discordGlobalName = interaction.user.globalName || null;
      return { username: user.username, discordId: user.discordId, vipUntil: user.vipUntil };
    });
  } catch (error) {
    await interaction.reply({ content: error?.status ? error.message : 'Could not link right now. Try again.', ephemeral: true });
    return;
  }
  linkTries.delete(interaction.user.id);
  const memberRole = await roleByName(interaction.guild, 'Member');
  if (memberRole) await interaction.member.roles.add(memberRole).catch(() => {});
  syncGoldVip(linked).catch(() => {});
  await interaction.reply({
    content: `Linked as **${linked.username}**. You can talk in the member channels now, and sign in on the site with Discord from now on.`,
    ephemeral: true,
  });
}

async function handleCommand(interaction) {
  if (interaction.commandName === 'report') {
    await handleReport(interaction).catch(() => {});
    return;
  }
  if (interaction.commandName === 'earn') {
    await replyEarn(interaction).catch(() => {});
    return;
  }
  if (interaction.commandName === 'balance' && !interaction.options.getString('username')) {
    await replyOwnBalance(interaction).catch(() => {});
    return;
  }
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
    if (interaction.commandName === 'account') {
      const sub = interaction.options.getSubcommand();
      const query = interaction.options.getString('username');
      if (sub === 'view') {
        const user = registeredAccount(findAccount(load(), query));
        await interaction.reply({ content: accountDetails(user), ephemeral: true });
        return;
      }
      if (sub === 'reset') {
        const password = String(interaction.options.getString('password') || '');
        if (password.length < 8 || password.length > 25 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
          fail(400, 'Password is 8–25 characters with a letter and a number');
        }
        const saved = update((state) => {
          const user = registeredAccount(findAccount(state, query));
          if (!user.password) fail(400, 'That account signs in with Discord, so there is no password to reset');
          user.password = hashPw(password);
          clearSessions(state, user.id);
          return user.username;
        });
        await interaction.reply({
          content: `Password for **${saved}** is now set. They need to sign in with that new password. The old one cannot be recovered.`,
          ephemeral: true,
        });
        return;
      }
      const removed = update((state) => {
        const user = registeredAccount(findAccount(state, query));
        if (openMatch(state, user.id)) fail(400, 'Finish their open match before deleting the account');
        state.users = state.users.filter((item) => item.id !== user.id);
        for (const other of state.users) {
          if (Array.isArray(other.friends)) other.friends = other.friends.filter((id) => id !== user.id);
        }
        clearSessions(state, user.id);
        return user.username;
      });
      await interaction.reply({ content: `Deleted **${removed}**.`, ephemeral: true });
      return;
    }
    if (interaction.commandName === 'tournament' && interaction.options.getSubcommand() === 'create') {
      const cup = createTournament(interaction.options);
      await interaction.reply({
        content: `Cup ${cup.name} is open for ${cup.maxPlayers} players until <t:${Math.floor(cup.endsAt / 1000)}:f>.`,
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
      if (role.name === 'Helper' || role.name === REVIEWER_ROLE_NAME) await ensureStaffChat(interaction.guild).catch(() => {});
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
        content: `${result.username} has ${Number(result.balance).toFixed(2)} tokens and ${result.points} Vault Points.`,
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'live') {
      const gate = setLaunchGate(interaction.options.getString('status'), interaction.options.getInteger('goal'));
      await tickLaunch().catch(() => {});
      const now = load().launchGate || gate;
      await interaction.reply({
        content: now.enabled
          ? `The site is locked behind the launch page. Members: **${now.members ?? '…'}/${now.goal}**. It opens by itself when the goal is reached.`
          : 'The launch page is off. The site is open.',
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'match' && interaction.options.getSubcommand() === 'history') {
      await interaction.reply({ ...matchHistoryPayload(interaction.options.getString('user')), ephemeral: true });
      return;
    }
    if (interaction.commandName === 'check' && interaction.options.getSubcommand() === 'rate') {
      await replyStatusRate(interaction);
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
  ['/account view', 'Show a site account, including Discord sign-ins: email, token balance, created date, VIP, and Discord.'],
  ['/account reset', 'Set a new password for an email account. Discord-only accounts have no password to reset.'],
  ['/account delete', 'Delete a site account, including a Discord sign-in, when they are not in an open match.'],
  ['/ban', 'Ban a site account from login and matchmaking for a number of hours.'],
  ['/unban', 'Clear a site ban so the player can sign in again.'],
  ['/balance', 'Anyone can see their own tokens and Vault Points. Owners can add a username to look up a player.'],
  ['/report', 'Anyone can report a member with a reason. Helpers get pinged in #filters and can Warn or Dismiss. 3 warnings in a week means a 1 hour timeout.'],
  ['/earn', 'Anyone can see how to earn 0.02 tokens a day by putting ogvault.co.uk in their Discord status, and their progress today.'],
  ['/live', 'Lock the whole site behind a launch page showing live Discord members against your goal (bots not counted). It opens by itself when the goal is hit.'],
  ['/match history', 'Every match a player has played: date, opponent, entry, project and region, who won, payout, forfeits, and who awarded disputes.'],
  ['/check rate', 'Live count of members showing ogvault.co.uk in their Discord status, and whether yours is detected.'],
  ['/blackjack bias', 'Show or set how often a player win is settled for the dealer. 0 is fair, 100 is the maximum edge.'],
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
        { name: 'Reviewer', value: 'Can press the award buttons on a clip-review message and talk in #staff-chat. No slash commands.' },
        { name: 'Helper', value: 'Can see support tickets, reply in them, close them, and talk in #staff-chat. No slash commands.' },
        { name: 'Content Creator', value: 'Display role only. No commands.' },
        { name: 'Member', value: 'Can talk in general, clips, and the community channels after linking a vault account. No slash commands.' },
        { name: 'Everyone', value: 'Can read the start-here channels, link a vault account, pick NA or EU, and open a support ticket.' },
      ),
  ];
}

const MEDALS = ['🥇', '🥈', '🥉'];
const SITE_URL = 'https://ogvault.co.uk';

const CONFETTI = '🎊 ✨ 🎉 ✨ 🎊 ✨ 🎉 ✨ 🎊 ✨ 🎉 ✨ 🎊';
const PLACE = ['Vault Champion', 'Runner-up', 'Third place'];

function winnerName(row) {
  return row.discordId ? `<@${row.discordId}>` : `**${row.username}**`;
}

export function weeklyResultMessage(result) {
  const day = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;
  const [champ, ...rest] = result.winners;
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'OGVAULT  •  Weekly Vault', iconURL: `${SITE_URL}/logo.png`, url: `${SITE_URL}/weekly` })
    .setTitle('🏆  The Vault Has Been Cracked  🏆')
    .setURL(`${SITE_URL}/weekly`)
    .setColor(0xf5c451)
    .setThumbnail(`${SITE_URL}/logo.png`)
    .setFooter({ text: 'Prizes were added to winners\' balances automatically', iconURL: `${SITE_URL}/logo.png` })
    .setTimestamp(result.end);
  if (!champ) {
    embed.setDescription([
      `-# ${day(result.start)} – ${day(result.end)}`,
      '',
      'Nobody earned Vault Points this week, so the vault stays locked. 🔒',
      '',
      '🔥 **A new week is live.** Be the first on the board!',
    ].join('\n'));
    return { content: '', embeds: [embed], allowedMentions: { parse: [] } };
  }
  embed.setDescription([
    CONFETTI,
    `-# Week of ${day(result.start)} – ${day(result.end)}`,
    '',
    `## 👑  ${champ.discordId ? `<@${champ.discordId}>` : champ.username}`,
    `🥇 **${PLACE[0]}**  •  ${Math.round(champ.points)} Vault Points`,
    `💰 **+${champ.prize} tokens** added to the vault`,
    '',
    CONFETTI,
  ].join('\n'));
  rest.forEach((row) => {
    embed.addFields({
      name: `${MEDALS[row.place - 1]}  ${PLACE[row.place - 1]}`,
      value: `${winnerName(row)}\n${Math.round(row.points)} Vault Points\n💰 **+${row.prize} tokens**`,
      inline: true,
    });
  });
  embed.addFields({
    name: '\u200b',
    value: '🔥 **A new week is live.** Claim your daily Vault Point and win token Kill Races to climb.\n🏅 Top 3 win **8**, **4** and **2 tokens**. [See the board](' + SITE_URL + '/weekly)',
  });
  const mentions = result.winners.map((row) => row.discordId).filter(Boolean);
  const shout = result.winners.map((row) => `${MEDALS[row.place - 1]} ${winnerName(row)}`).join('  ');
  return {
    content: `🎉🎊 **Congratulations to this week's Weekly Vault winners!** 🎊🎉\n${shout}`,
    embeds: [embed],
    allowedMentions: { users: mentions },
  };
}

async function announceWeeklyResults() {
  if (!bot?.isReady?.()) return;
  update((state) => { ensurePotw(state); });
  const pending = (load().potwResults || []).filter((row) => !row.announced);
  if (!pending.length) return;
  const guild = statusGuild();
  if (!guild) return;
  const channels = await guild.channels.fetch();
  const channel = channels.find((item) => item?.type === ChannelType.GuildText && item.name === 'announcements');
  if (!channel) return;
  for (const result of pending) {
    const sent = await channel.send(weeklyResultMessage(result)).catch(() => null);
    if (sent) await sent.react('🎉').catch(() => {});
    if (!sent) return;
    update((state) => {
      const row = (state.potwResults || []).find((item) => item.id === result.id);
      if (row) row.announced = true;
    });
  }
}

const WARN_LIMIT = 3;
const WARN_TIMEOUT_MS = 60 * 60 * 1000;
const WARN_RESET_MS = 7 * 24 * 60 * 60 * 1000;
let filtersChannelId = '';

async function postFilters(payload) {
  if (!filtersChannelId || !bot) return null;
  const channel = await bot.channels.fetch(filtersChannelId).catch(() => null);
  return channel ? channel.send({ allowedMentions: { parse: ['roles'] }, ...payload }).catch(() => null) : null;
}

async function warnMember(guild, userId, reason, by) {
  const now = Date.now();
  const count = update((state) => {
    state.discordWarnings = state.discordWarnings || {};
    const row = state.discordWarnings[userId];
    const next = row && now - row.at < WARN_RESET_MS ? row.count + 1 : 1;
    state.discordWarnings[userId] = { count: next >= WARN_LIMIT ? 0 : next, at: now };
    return next;
  });
  const member = await guild.members.fetch(userId).catch(() => null);
  let timedOut = false;
  if (count >= WARN_LIMIT && member) {
    timedOut = await member.timeout(WARN_TIMEOUT_MS, `${WARN_LIMIT} warnings: ${reason}`.slice(0, 500)).then(() => true).catch(() => false);
  }
  const dm = timedOut
    ? `You were timed out in OGVAULT for 1 hour after ${WARN_LIMIT} warnings. Last reason: ${reason}`
    : `Warning ${count}/${WARN_LIMIT} in OGVAULT: ${reason}. At ${WARN_LIMIT} warnings you are timed out for 1 hour.`;
  if (member) await member.send(dm).catch(() => {});
  await postFilters({
    embeds: [
      new EmbedBuilder()
        .setColor(timedOut ? 0xe74c3c : 0xf39c12)
        .setTitle(timedOut ? 'Timed out for 1 hour' : `Warning ${count}/${WARN_LIMIT}`)
        .setDescription(`<@${userId}> · ${reason}`.slice(0, 4000))
        .setFooter({ text: `By ${by}` })
        .setTimestamp(),
    ],
  });
  return { count, timedOut };
}

async function onAutoModAction(execution) {
  if (execution.action?.type !== AutoModerationActionType.BlockMessage) return;
  const guild = execution.guild;
  if (!guild || !execution.userId) return;
  const rule = execution.autoModerationRule?.name || 'AutoMod';
  const word = execution.matchedKeyword ? ` (${execution.matchedKeyword})` : '';
  await warnMember(guild, execution.userId, `${rule.replace(/^OGVAULT:\s*/, '')}${word}`, 'AutoMod');
}

function isStaffMember(member) {
  if (!member) return false;
  if (adminIds().includes(member.id)) return true;
  return member.roles.cache.some((role) => [REVIEWER_ROLE_NAME, 'Helper', 'Owner'].includes(role.name));
}

async function handleReport(interaction) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  if (!target || target.bot) {
    await interaction.reply({ content: 'Pick a member to report.', ephemeral: true });
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.reply({ content: 'You cannot report yourself.', ephemeral: true });
    return;
  }
  const helper = await roleByName(interaction.guild, 'Helper');
  const voice = interaction.guild.voiceStates.cache.get(target.id)?.channel;
  const sent = await postFilters({
    content: helper ? `<@&${helper.id}> new report` : 'New report',
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Member report')
        .addFields(
          { name: 'Reported', value: `<@${target.id}> (${target.id})`, inline: true },
          { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Where', value: voice ? `🔊 ${voice.name}` : `<#${interaction.channelId}>`, inline: true },
          { name: 'Reason', value: reason.slice(0, 1000) },
        )
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ogmod:warn:${target.id}`).setLabel('Warn').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ogmod:dismiss:${target.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  await interaction.reply({
    content: sent ? 'Thanks. Your report was sent to the Helpers.' : 'Reports are not set up yet. Open a support ticket instead.',
    ephemeral: true,
  });
}

async function handleModButton(interaction) {
  if (!isStaffMember(interaction.member)) {
    await interaction.reply({ content: 'Only Helpers can do that.', ephemeral: true });
    return;
  }
  const [, action, userId] = interaction.customId.split(':');
  const original = interaction.message.embeds[0];
  const reason = original?.fields?.find((field) => field.name === 'Reason')?.value || 'Reported by a member';
  const done = (text) => interaction.update({
    embeds: original ? [EmbedBuilder.from(original).setFooter({ text })] : [],
    components: [],
  });
  if (action === 'dismiss') {
    await done(`Dismissed by ${interaction.user.username}`);
    return;
  }
  if (action === 'warn') {
    const result = await warnMember(interaction.guild, userId, reason, interaction.user.username);
    await done(result.timedOut
      ? `Warned by ${interaction.user.username} · timed out for 1 hour`
      : `Warned by ${interaction.user.username} · ${result.count}/${WARN_LIMIT}`);
  }
}

async function ensureAutoMod(guild, alertChannel) {
  const roles = await guild.roles.fetch();
  const exemptRoles = [REVIEWER_ROLE_NAME, 'Helper', 'Owner']
    .map((name) => roles.find((role) => role.name === name)?.id)
    .filter(Boolean);
  const exemptChannels = (await guild.channels.fetch())
    .filter((item) => item?.type === ChannelType.GuildText && (item.name === 'staff-chat' || item.name === 'filters'))
    .map((item) => item.id);
  const block = (text) => ({ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: text } });
  const alert = alertChannel ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel.id } }] : [];
  const timeout = (seconds) => ({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: seconds } });
  const rules = [
    {
      name: 'OGVAULT: slurs and NSFW',
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: {
        presets: [
          AutoModerationRuleKeywordPresetType.Slurs,
          AutoModerationRuleKeywordPresetType.SexualContent,
          AutoModerationRuleKeywordPresetType.Profanity,
        ],
      },
      actions: [block('Keep it clean. That message was blocked.'), ...alert],
    },
    {
      name: 'OGVAULT: scams and invites',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        regexPatterns: [
          'discord(?:\\.gg|(?:app)?\\.com/invite)/\\S+',
          'free\\s*nitro',
          'steam\\s*gift',
          'airdrop',
          '(?:grabify|iplogger|2no)\\.(?:link|org|co)',
        ],
      },
      actions: [block('Links to other servers and giveaway scams are not allowed.'), ...alert],
    },
    {
      name: 'OGVAULT: mention spam',
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
      actions: [block('Too many mentions.'), timeout(10 * 60), ...alert],
    },
    {
      name: 'OGVAULT: spam',
      triggerType: AutoModerationRuleTriggerType.Spam,
      triggerMetadata: {},
      actions: [block('That looked like spam.'), ...alert],
    },
  ];
  const existing = await guild.autoModerationRules.fetch();
  for (const rule of rules) {
    const payload = {
      name: rule.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: rule.triggerType,
      triggerMetadata: rule.triggerMetadata,
      actions: rule.actions,
      enabled: true,
      exemptRoles,
      exemptChannels,
    };
    const current = existing.find((item) => item.name === rule.name)
      || existing.find((item) => item.triggerType === rule.triggerType
        && (rule.triggerType === AutoModerationRuleTriggerType.Spam
          || rule.triggerType === AutoModerationRuleTriggerType.MentionSpam
          || rule.triggerType === AutoModerationRuleTriggerType.KeywordPreset));
    try {
      if (current) {
        const { triggerType, ...edit } = payload;
        await current.edit(edit);
      } else {
        await guild.autoModerationRules.create(payload);
      }
    } catch (error) {
      console.error(`AutoMod rule failed: ${rule.name}`, error?.message || '');
    }
  }
}

async function ensureVoiceChannels(guild) {
  const channels = await guild.channels.fetch();
  const community = channels.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === 'Community');
  const roles = await guild.roles.fetch();
  const member = roles.find((role) => role.name === 'Member');
  const helper = roles.find((role) => role.name === 'Helper');
  const P = PermissionFlagsBits;
  const voiceUse = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD];
  const noFun = [P.UseSoundboard, P.UseExternalSounds];
  const moderation = [P.MuteMembers, P.DeafenMembers, P.MoveMembers];
  const base = community
    ? community.permissionOverwrites.cache.map((item) => ({ id: item.id, type: item.type, allow: item.allow.bitfield, deny: item.deny.bitfield }))
    : [];
  const merge = (id, allow, deny) => {
    const row = base.find((item) => item.id === id);
    const allowBits = allow.reduce((sum, bit) => sum | bit, 0n);
    const denyBits = deny.reduce((sum, bit) => sum | bit, 0n);
    if (row) {
      row.allow = (BigInt(row.allow) | allowBits) & ~denyBits;
      row.deny = (BigInt(row.deny) | denyBits) & ~allowBits;
    } else base.push({ id, allow: allowBits, deny: denyBits });
  };
  merge(guild.roles.everyone.id, [], [...noFun, ...moderation]);
  if (member) merge(member.id, voiceUse, [...noFun, ...moderation]);
  if (helper) merge(helper.id, [...voiceUse, ...moderation], noFun);
  merge(guild.members.me.id, [...voiceUse, ...moderation], []);
  for (const name of ['General', 'Retrac', 'EON']) {
    let channel = channels.find((item) => item.type === ChannelType.GuildVoice && item.name === name && (!community || item.parentId === community.id));
    if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: community?.id });
    await channel.permissionOverwrites.set(base.map((item) => ({ id: item.id, allow: item.allow, deny: item.deny, ...(item.type != null ? { type: item.type } : {}) })));
  }
}

function ensureStaffChat(guild) {
  return ensureStaffText(guild, 'staff-chat', 'Private chat for Helpers and Reviewers.');
}

function ensureFilters(guild) {
  return ensureStaffText(guild, 'filters', 'AutoMod alerts, warnings, and member reports.');
}

async function ensureStaffText(guild, channelName, topic) {
  const channels = await guild.channels.fetch();
  const staff = channels.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === 'Staff');
  const roles = await guild.roles.fetch();
  const staffRoles = [REVIEWER_ROLE_NAME, 'Helper', 'Owner']
    .map((name) => roles.find((role) => role.name === name))
    .filter(Boolean);
  const talk = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: talk },
    ...staffRoles.map((role) => ({ id: role.id, allow: talk })),
  ];
  const existing = channels.find((item) => item.type === ChannelType.GuildText && item.name === channelName);
  if (existing) {
    await existing.permissionOverwrites.set(permissionOverwrites);
    if (staff && existing.parentId !== staff.id) await existing.setParent(staff.id, { lockPermissions: false });
    return existing;
  }
  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: staff?.id,
    topic,
    permissionOverwrites,
  });
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

let statusTimer = null;

export function startDiscordAdmin(withPresence = true) {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Discord admin commands are not configured');
    return;
  }
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  botFailed = false;
  const baseIntents = [GatewayIntentBits.Guilds, GatewayIntentBits.AutoModerationExecution, GatewayIntentBits.GuildVoiceStates];
  const intents = withPresence ? [...baseIntents, GatewayIntentBits.GuildPresences] : baseIntents;
  const client = new Client({ intents });
  bot = client;
  presenceEnabled = withPresence;
  if (withPresence && !statusTimer) {
    statusTimer = setInterval(() => {
      try { tickStatusRewards(); } catch { console.error('Status reward tick failed'); }
    }, STATUS_TICK_MS);
  }
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
      await ensureStaffChat(await client.guilds.fetch(guildId)).catch(() => console.error('Could not set up staff-chat'));
      const filters = await ensureFilters(await client.guilds.fetch(guildId)).catch(() => console.error('Could not set up filters'));
      filtersChannelId = filters?.id || '';
      await ensureAutoMod(await client.guilds.fetch(guildId), filters).then(() => console.log('AutoMod rules applied')).catch((error) => console.error('Could not set up AutoMod', error?.message || ''));
      tickLaunch().catch(() => console.error('Launch member count failed'));
      setInterval(() => { tickLaunch().catch(() => {}); }, 30 * 1000);
      announceWeeklyResults().catch(() => console.error('Weekly Vault announcement failed'));
      setInterval(() => { announceWeeklyResults().catch(() => console.error('Weekly Vault announcement failed')); }, 5 * 60 * 1000);
      await ensureVoiceChannels(await client.guilds.fetch(guildId)).catch(() => console.error('Could not set up voice channels'));
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
      if (kind === 'staff') interaction.reply(staffRolePicker()).catch(() => {});
      else interaction.showModal(ticketModal(kind)).catch(() => {});
      return;
    }
    if (interaction.isButton() && String(interaction.customId || '').startsWith('ogvault:staffapp:')) {
      const role = interaction.customId.split(':').pop();
      if (!STAFF_ROLES[role]) return;
      interaction.showModal(ticketModal('staff', role)).catch(() => {});
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
    if (interaction.isModalSubmit() && interaction.customId === 'ogvault:link:form') {
      handlePasswordLink(interaction).catch(() => {});
      return;
    }
    if (interaction.isButton() && String(interaction.customId || '').startsWith('ogmod:')) {
      handleModButton(interaction).catch(() => {});
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
  client.on('autoModerationActionExecution', (execution) => {
    onAutoModAction(execution).catch(() => console.error('AutoMod warning failed'));
  });
  client.on('error', () => {
    console.error('Discord admin bot error');
  });
  client.login(token).catch((error) => {
    if (withPresence && /disallowed intents/i.test(String(error?.message || ''))) {
      console.error('Presence Intent is off in the Discord Developer Portal; status rewards are disabled');
      Promise.resolve().then(() => client.destroy()).catch(() => {});
      startDiscordAdmin(false);
      return;
    }
    botFailed = true;
    console.error('Discord admin bot could not log in');
  });
}
