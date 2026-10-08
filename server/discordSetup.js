const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const adminIds = String(process.env.DISCORD_ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => /^\d{5,32}$/.test(id));

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const HISTORY = 1n << 16n;
const REACTIONS = 1n << 6n;
const EMBED = 1n << 14n;
const FILES = 1n << 15n;
const COMMANDS = 1n << 31n;
const ADMIN = 1n << 3n;

const memberBits = VIEW | SEND | HISTORY | REACTIONS | EMBED | FILES | COMMANDS;

function bits(value) {
  return value.toString();
}

async function api(method, path, body) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || response.statusText;
    throw new Error(`${method} ${path} ${response.status} ${message}`);
  }
  return data;
}

function overwrite(id, allow, deny) {
  return { id, type: 0, allow: bits(allow), deny: bits(deny) };
}

async function ensureRole(roles, spec) {
  let role = roles.find((item) => item.name === spec.name);
  if (!role) {
    role = await api('POST', `/guilds/${guildId}/roles`, {
      name: spec.name,
      color: spec.color,
      hoist: spec.hoist,
      mentionable: !!spec.mentionable,
      permissions: bits(spec.permissions),
    });
    roles.push(role);
    console.log('role', spec.name);
  }
  return role;
}

async function ensureCategory(channels, name) {
  let category = channels.find((item) => item.type === 4 && item.name === name);
  if (!category) {
    category = await api('POST', `/guilds/${guildId}/channels`, { name, type: 4 });
    channels.push(category);
    console.log('category', name);
  }
  return category;
}

async function ensureText(channels, parent, name, topic, permissionOverwrites) {
  let channel = channels.find((item) => item.type === 0 && item.parent_id === parent.id && item.name === name);
  if (!channel) {
    channel = await api('POST', `/guilds/${guildId}/channels`, {
      name,
      type: 0,
      parent_id: parent.id,
      topic,
      permission_overwrites: permissionOverwrites,
    });
    channels.push(channel);
    console.log('channel', name);
  } else {
    await api('PATCH', `/channels/${channel.id}`, { topic, permission_overwrites: permissionOverwrites });
  }
  return channel;
}

async function upsertMessage(channelId, payload, aliases = []) {
  const messages = await api('GET', `/channels/${channelId}/messages?limit=20`);
  const titles = [payload.embeds[0].title, ...aliases];
  const existing = messages.find((message) => message.author?.bot && titles.includes(message.embeds?.[0]?.title));
  if (existing) {
    await api('PATCH', `/channels/${channelId}/messages/${existing.id}`, payload);
    console.log('updated', payload.embeds[0].title);
    return;
  }
  await api('POST', `/channels/${channelId}/messages`, payload);
  console.log('posted', payload.embeds[0].title);
}

const SITE = 'https://ogvault.co.uk';
const LOGO = `${SITE}/logo.png`;
const GOLD = 0xf5c451;
const author = { name: 'OGVAULT', icon_url: LOGO, url: SITE };
const footer = { text: 'ogvault.co.uk  •  18+ only  •  Play fair', icon_url: LOGO };
const divider = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
const siteButton = (label = 'Open OGVAULT') => ({ type: 2, style: 5, label, url: SITE, emoji: { name: '🌐' } });

const rules = [
  ['🔞', 'Age', 'You must be 18 or older to play.'],
  ['🤝', 'Respect', 'No slurs, harassment, threats, or slandering your opponent.'],
  ['👤', 'One account', 'One account per person and per network. No smurfs, alts, or VPNs.'],
  ['🎮', 'Right project', 'Play on the project the lobby is for (Eon or Retrac), then both players report the same winner.'],
  ['🎥', 'Record everything', 'Screen record your entire screen from readying up until you die or win. If you cannot, make sure replays are on.'],
  ['🚫', 'No cheating', 'No ESP, aimbot, macros, or any unfair advantage. No playing a second match at the same time.'],
  ['💰', 'Payouts', 'The winner takes the pot after the 20% fee. Staff decisions on disputes are final.'],
  ['🔒', 'Stay safe', 'Never post payment details, wallet addresses, or bank info in public channels.'],
  ['⛔', 'Zero tolerance', 'Scams, chargebacks, and fake clips mean a permanent ban.'],
].map(([emoji, title, text], index) => `${emoji} **${index + 1}. ${title}**\n${text}`).join('\n\n');

const howTo = [
  ['Create your account', `Sign up at **[ogvault.co.uk](${SITE})** and sign in with Discord.`],
  ['Open or join a lobby', 'Pick Eon or Retrac, your region, and play for **Vault Tokens** or free **Vault Points**.'],
  ['Ready up', 'Both players press Ready on the site, then load into the match.'],
  ['Record your screen', '**Record your entire screen** from readying up until you die or win.'],
  ['Report the winner', 'Both players pick who won in the lobby. When both reports match, the winner is paid the pot.'],
  ['Disputes', 'If you disagree, both players upload their MP4 and vote again. Still stuck? Press **Send for review** and a reviewer decides.'],
].map(([title, text], index) => `**\`${index + 1}\`  ${title}**\n${text}`).join('\n\n');

async function main() {
  if (!guildId || !token) throw new Error('Discord is not configured');
  const roles = await api('GET', `/guilds/${guildId}/roles`);
  const everyone = roles.find((role) => role.id === guildId);
  const bot = roles.find((role) => role.tags?.bot_id);
  const owner = await ensureRole(roles, { name: 'Owner', color: 0xf1c40f, hoist: true, permissions: ADMIN });
  const member = await ensureRole(roles, { name: 'Member', color: 0x5865f2, hoist: true, permissions: memberBits });
  const na = await ensureRole(roles, { name: 'NA', color: 0x3b82f6, hoist: true, mentionable: true, permissions: 0n });
  const eu = await ensureRole(roles, { name: 'EU', color: 0x22c55e, hoist: true, mentionable: true, permissions: 0n });
  const reviewer = roles.find((role) => role.name === 'Reviewer');
  const creator = await ensureRole(roles, { name: 'Content Creator', color: 0xe84393, hoist: true, mentionable: true, permissions: 0n });
  const helper = await ensureRole(roles, { name: 'Helper', color: 0xe67e22, hoist: true, mentionable: true, permissions: 0n });

  const ordered = [everyone, na, eu, member, creator, helper, reviewer, owner, bot].filter(Boolean);
  await api('PATCH', `/guilds/${guildId}/roles`, ordered.map((role, position) => ({ id: role.id, position })));
  console.log('roles ordered');

  for (const userId of adminIds) {
    await api('PUT', `/guilds/${guildId}/members/${userId}/roles/${owner.id}`);
    console.log('owner assigned');
  }

  let channels = await api('GET', `/guilds/${guildId}/channels`);
  const staff = channels.find((item) => item.type === 4 && (item.name === 'Zaidan mess' || item.name === 'Staff'));
  const finance = channels.find((item) => item.type === 4 && (item.name === '💰' || item.name === 'Finance'));
  if (staff && staff.name !== 'Staff') {
    await api('PATCH', `/channels/${staff.id}`, { name: 'Staff' });
    staff.name = 'Staff';
  }
  if (finance && finance.name !== 'Finance') {
    await api('PATCH', `/channels/${finance.id}`, { name: 'Finance' });
    finance.name = 'Finance';
  }

  const start = await ensureCategory(channels, 'Start here');
  const community = await ensureCategory(channels, 'Community');
  const news = await ensureCategory(channels, 'News');

  const gateView = [
    overwrite(everyone.id, VIEW | HISTORY, SEND),
    overwrite(member.id, VIEW | HISTORY, SEND),
  ];
  const memberChat = [
    overwrite(everyone.id, 0n, VIEW),
    overwrite(member.id, VIEW | SEND | HISTORY | REACTIONS | FILES | EMBED, 0n),
  ];
  const memberRead = [
    overwrite(everyone.id, 0n, VIEW),
    overwrite(member.id, VIEW | HISTORY, SEND),
  ];

  const welcome = await ensureText(channels, start, 'welcome', 'Start here. 18+.', gateView);
  const rulesChannel = await ensureText(channels, start, 'rules', 'Server rules.', gateView);
  const guide = await ensureText(channels, start, 'how-to-play', 'How an OGVAULT Kill Race works.', gateView);
  const verify = await ensureText(channels, start, 'verify', 'Link the Discord you use on OGVAULT.', gateView);
  const regions = await ensureText(channels, start, 'regions', 'Pick NA or EU.', gateView);
  const general = await ensureText(channels, community, 'general', 'Talk with other players.', memberChat);
  await ensureText(channels, community, 'clips', 'Post your match clips.', memberChat);
  await ensureText(channels, community, 'support', 'Ask for help with a lobby.', memberChat);
  const announcements = await ensureText(channels, news, 'announcements', 'Updates from OGVAULT. Members can read, not type.', [
    overwrite(everyone.id, 0n, VIEW | SEND),
    overwrite(member.id, VIEW | HISTORY | REACTIONS, SEND),
    ...[helper, reviewer, creator, na, eu].filter(Boolean).map((role) => overwrite(role.id, 0n, SEND)),
    overwrite(owner.id, VIEW | HISTORY | SEND | EMBED | FILES | REACTIONS, 0n),
  ]);
  const supportPanel = await ensureText(
    channels,
    start,
    'support',
    'Open a private ticket. Only you and the owner can see it.',
    gateView,
  );

  const hidden = [overwrite(everyone.id, 0n, VIEW), overwrite(member.id, 0n, VIEW)];
  for (const channel of channels) {
    if (!channel.parent_id) continue;
    const parent = channels.find((item) => item.id === channel.parent_id);
    if (!parent || (parent.name !== 'Staff' && parent.name !== 'Finance')) continue;
    const current = channel.permission_overwrites || [];
    const rest = current.filter((item) => item.id !== everyone.id && item.id !== member.id);
    await api('PATCH', `/channels/${channel.id}`, { permission_overwrites: [...rest, ...hidden] });
  }

  channels = await api('GET', `/guilds/${guildId}/channels`);
  const order = [
    ['Start here', ['welcome', 'rules', 'how-to-play', 'verify', 'regions', 'support']],
    ['Community', ['general', 'clips', 'support']],
    ['News', ['announcements']],
    ['Staff', null],
    ['Finance', null],
  ];
  const moves = [];
  order.forEach(([categoryName, children], index) => {
    const category = channels.find((item) => item.type === 4 && item.name === categoryName);
    if (!category) return;
    moves.push({ id: category.id, position: index });
    if (!children) return;
    children.forEach((name, childIndex) => {
      const child = channels.find((item) => item.type === 0 && item.parent_id === category.id && item.name === name);
      if (child) moves.push({ id: child.id, position: childIndex });
    });
  });
  await api('PATCH', `/guilds/${guildId}/channels`, moves);

  const oldSupport = channels.find((item) => item.type === 0 && item.name === 'support' && item.id !== supportPanel.id && item.parent_id === start.id);
  if (oldSupport) await api('DELETE', `/channels/${oldSupport.id}`);
  await postPanels({ welcome, rulesChannel, guide, verify, regions, supportPanel, announcements });
  console.log('ready', general.name);
}

async function postPanelsOnly() {
  if (!guildId || !token) throw new Error('Discord is not configured');
  const channels = await api('GET', `/guilds/${guildId}/channels`);
  const category = (name) => channels.find((item) => item.type === 4 && item.name === name);
  const start = category('Start here');
  const news = category('News');
  const text = (parent, name) => channels.find((item) => item.type === 0 && item.parent_id === parent?.id && item.name === name);
  const found = {
    welcome: text(start, 'welcome'),
    rulesChannel: text(start, 'rules'),
    guide: text(start, 'how-to-play'),
    verify: text(start, 'verify'),
    regions: text(start, 'regions'),
    supportPanel: text(start, 'support') || text(category('Community'), 'support'),
    announcements: text(news, 'announcements'),
  };
  const missing = Object.entries(found).filter(([key, value]) => !value && key !== 'supportPanel').map(([key]) => key);
  if (missing.length) throw new Error(`Missing channels: ${missing.join(', ')}`);
  await postPanels(found);
  console.log('panels updated');
}

async function postPanels({ welcome, rulesChannel, guide, verify, regions, supportPanel, announcements }) {
  await upsertMessage(welcome.id, {
    embeds: [{
      author,
      title: 'Welcome to OGVAULT',
      description: [
        '### The home of OG Fortnite 1v1 Kill Races',
        'Wager on your skill in **Eon** and **Retrac**. Win the pot, climb the leaderboard, and earn your place in the Weekly Vault.',
        divider,
      ].join('\n'),
      color: GOLD,
      thumbnail: { url: LOGO },
      fields: [
        { name: '⚔️  1v1 Kill Races', value: 'Most kills in one game takes the pot.', inline: true },
        { name: '🪙  Vault Tokens', value: 'Real pots. Winner takes the pot.', inline: true },
        { name: '⭐  Vault Points', value: 'Free to earn. Top 3 each week win tokens.', inline: true },
        { name: 'Get started', value: '**1.** Read <#' + rulesChannel.id + '>\n**2.** Link your account in <#' + verify.id + '>\n**3.** Pick your region in <#' + regions.id + '>' },
      ],
      footer,
    }],
    components: [{ type: 1, components: [siteButton('Play now')] }],
  });
  await upsertMessage(rulesChannel.id, {
    embeds: [{
      author,
      title: 'Server Rules',
      description: `Breaking these rules can get you warned, timed out, or banned from both Discord and the site.\n${divider}\n\n${rules}`,
      color: 0xe5484d,
      footer: { ...footer, text: '3 warnings in a week = 1 hour timeout  •  Use /report to flag someone' },
    }],
  }, ['Rules']);
  await upsertMessage(guide.id, {
    embeds: [{
      author,
      title: 'How to Play',
      description: `From sign-up to payout in six steps.\n${divider}\n\n${howTo}`,
      color: 0x5b8cff,
      footer,
    }],
    components: [{ type: 1, components: [siteButton('Open a lobby')] }],
  }, ['How to play']);
  await upsertMessage(verify.id, {
    embeds: [{
      author,
      title: 'Link Your Account',
      description: [
        'Connect your Discord to your OGVAULT account to unlock the member channels.',
        divider,
        `**\`1\`**  Sign in with Discord on **[ogvault.co.uk](${SITE})**`,
        '**`2`**  Come back here and press **Link my account**',
        '**`3`**  You get the **Member** role and full access',
        '',
        '**Registered with an email?** Press **Link with password** and enter your site login. It is checked privately and never shown to anyone.',
      ].join('\n'),
      color: 0x3ecf8e,
      footer: { ...footer, text: 'Linking also lets you use /balance and /earn' },
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Link my account', custom_id: 'ogvault:verify', emoji: { name: '🔗' } },
        { type: 2, style: 1, label: 'Link with password', custom_id: 'ogvault:verify:password', emoji: { name: '🔑' } },
      ],
    }],
  }, ['Link your account']);
  await upsertMessage(regions.id, {
    embeds: [{
      author,
      title: 'Choose Your Region',
      description: [
        'Pick where you play so you can find opponents with the best ping.',
        divider,
        '🇺🇸  **NA** · North America',
        '🇪🇺  **EU** · Europe',
        '',
        '-# You can switch any time. This does not change the region of a lobby.',
      ].join('\n'),
      color: 0x5b8cff,
      footer,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: 'North America', custom_id: 'ogvault:region:na', emoji: { name: '🇺🇸' } },
        { type: 2, style: 1, label: 'Europe', custom_id: 'ogvault:region:eu', emoji: { name: '🇪🇺' } },
      ],
    }],
  }, ['Pick your region']);
  if (supportPanel) await upsertMessage(supportPanel.id, {
    embeds: [{
      author,
      title: 'Support Centre',
      description: [
        'Need a hand? Open a **private ticket** and our team will get back to you. Only you and staff can see it.',
        divider,
      ].join('\n'),
      color: GOLD,
      thumbnail: { url: LOGO },
      fields: [
        { name: '🐞  Bugs', value: 'Site broken or not loading', inline: true },
        { name: '💳  Withdrawals', value: 'Payout late or missing', inline: true },
        { name: '👤  Account', value: 'Login, bans or linking', inline: true },
        { name: '🎬  Content', value: 'Create for OGVAULT', inline: true },
        { name: '🛡️  Staff', value: 'Apply for Reviewer or Helper', inline: true },
        { name: '\u200b', value: '-# Staff applications can be open alongside another ticket.', inline: true },
        { name: 'Before you open one', value: '-# Have your site username ready. For a match dispute, use **Send for review** in the lobby instead. To flag a player, use `/report`.' },
      ],
      footer: { ...footer, text: 'Never share your password with anyone, including staff' },
    }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'ogvault:ticket:pick',
        placeholder: '📩  Open a ticket: choose your issue',
        options: [
          { label: 'Report a bug', value: 'bug', description: 'Something on the site is broken', emoji: { name: '🐞' } },
          { label: 'Withdrawal', value: 'withdraw', description: 'A payout has not arrived', emoji: { name: '💳' } },
          { label: 'Account issue', value: 'account', description: 'Login, ban, or account help', emoji: { name: '👤' } },
          { label: 'Content creation', value: 'content', description: 'Apply to make content for OGVAULT', emoji: { name: '🎬' } },
          { label: 'Staff application', value: 'staff', description: 'Apply to be a Reviewer or Helper', emoji: { name: '🛡️' } },
        ],
      }],
    }],
  }, ['Support']);
  await upsertMessage(announcements.id, {
    embeds: [{ author, title: 'Announcements', description: 'Updates, new features, and Weekly Vault winners land here. Only staff can post.', color: GOLD, footer }],
  });
}

(process.argv.includes('--panels') ? postPanelsOnly() : main()).catch((error) => {
  console.error(error.message || 'setup failed');
  process.exit(1);
});
