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

async function upsertMessage(channelId, payload) {
  const messages = await api('GET', `/channels/${channelId}/messages?limit=20`);
  const existing = messages.find((message) => message.author?.bot && message.embeds?.[0]?.title === payload.embeds[0].title);
  if (existing) {
    await api('PATCH', `/channels/${channelId}/messages/${existing.id}`, payload);
    console.log('updated', payload.embeds[0].title);
    return;
  }
  await api('POST', `/channels/${channelId}/messages`, payload);
  console.log('posted', payload.embeds[0].title);
}

const rules = [
  'You must be 18 or older.',
  'No slurs, harassment, or threats.',
  'One account per person. No smurfing and no begging for tokens.',
  'Play the match on Eon or Retrac, then both players report the same winner.',
  'Record the full match. Staff review the clips if you disagree, and that decision stands.',
  'The winner is paid the pot after the 20% fee.',
  'Do not post payment details, wallet addresses, or bank info in public channels.',
  'Scams, chargebacks, and fake clips get you banned.',
].map((line, index) => `**${index + 1}.** ${line}`).join('\n');

const howTo = [
  'Create an account at https://ogvault.co.uk and sign in with Discord.',
  'Open a 1v1, pick Eon or Retrac, EU or NA, and your entry.',
  'Your opponent joins the lobby. Both players press ready.',
  'Play the kill race in the project, not in the browser.',
  'Both players report the winner. If the reports match, the prize is paid.',
  'If they do not match, upload your clip and send the match for review.',
].map((line, index) => `**${index + 1}.** ${line}`).join('\n');

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
  const guide = await ensureText(channels, start, 'how-to-play', 'How an OGVAULT 1v1 works.', gateView);
  const verify = await ensureText(channels, start, 'verify', 'Link the Discord you use on OGVAULT.', gateView);
  const regions = await ensureText(channels, start, 'regions', 'Pick NA or EU.', gateView);
  const general = await ensureText(channels, community, 'general', 'Talk with other players.', memberChat);
  await ensureText(channels, community, 'clips', 'Post your match clips.', memberChat);
  await ensureText(channels, community, 'support', 'Ask for help with a lobby.', memberChat);
  const announcements = await ensureText(channels, news, 'announcements', 'Updates from OGVAULT. Members can read, not type.', memberRead);
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

  await upsertMessage(welcome.id, {
    embeds: [{
      title: 'Welcome to OGVAULT',
      description: 'OG 1v1 kill races for real pots.\n\nRead the rules, link your Discord, then pick NA or EU. Member channels open after your vault account is linked.',
      color: 0xf1c40f,
    }],
  });
  await upsertMessage(rulesChannel.id, { embeds: [{ title: 'Rules', description: rules, color: 0xed4245 }] });
  await upsertMessage(guide.id, { embeds: [{ title: 'How to play', description: howTo, color: 0x5865f2 }] });
  await upsertMessage(verify.id, {
    embeds: [{
      title: 'Link your account',
      description: 'Sign in with Discord on https://ogvault.co.uk, then press the button. That connects this Discord user to your vault account and gives you the Member role.',
      color: 0x57f287,
    }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Link my account', custom_id: 'ogvault:verify' }] }],
  });
  await upsertMessage(regions.id, {
    embeds: [{
      title: 'Pick your region',
      description: 'Choose NA or EU when you join. You can switch later. This does not change the region of a lobby.',
      color: 0x3b82f6,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: 'NA', custom_id: 'ogvault:region:na' },
        { type: 2, style: 3, label: 'EU', custom_id: 'ogvault:region:eu' },
      ],
    }],
  });
  const oldSupport = channels.find((item) => item.type === 0 && item.name === 'support' && item.id !== supportPanel.id);
  if (oldSupport) await api('DELETE', `/channels/${oldSupport.id}`);
  await upsertMessage(supportPanel.id, {
    embeds: [{
      title: 'Support',
      description: 'Please pick from the options below your issue.',
      color: 0x5865f2,
    }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'ogvault:ticket:pick',
        placeholder: 'Choose your issue...',
        options: [
          { label: 'Report a bug', value: 'bug', description: 'Something on the site is broken', emoji: { name: '🐞' } },
          { label: 'Withdrawal', value: 'withdraw', description: 'A payout has not arrived', emoji: { name: '💳' } },
          { label: 'Account issue', value: 'account', description: 'Login, ban, or account help', emoji: { name: '👤' } },
          { label: 'Content creation', value: 'content', description: 'Apply to make content for OGVAULT', emoji: { name: '🎬' } },
        ],
      }],
    }],
  });
  await upsertMessage(announcements.id, {
    embeds: [{ title: 'Announcements', description: 'Updates land here. Only staff can post.', color: 0xf1c40f }],
  });
  console.log('ready', general.name);
}

main().catch((error) => {
  console.error(error.message || 'setup failed');
  process.exit(1);
});
