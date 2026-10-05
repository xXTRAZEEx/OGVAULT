import { fail } from './store.js';

const BLOCKED = [
  'nigger', 'nigga', 'negro', 'chink', 'gook', 'kike', 'spic', 'wetback', 'paki', 'raghead',
  'towelhead', 'beaner', 'coon', 'darkie', 'honky', 'cracker', 'nazi', 'hitler', 'kkk',
  'faggot', 'fag', 'dyke', 'tranny', 'shemale',
  'bitch', 'whore', 'slut', 'cunt', 'skank', 'thot',
  'retard', 'rapist', 'rape',
  'asshole', 'dick',
];

function fold(username) {
  return String(username || '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

export function offensiveName(username) {
  const folded = fold(username);
  return BLOCKED.some((word) => folded.includes(word));
}

export function assertCleanUsername(username) {
  if (offensiveName(username)) fail(400, "That username isn't allowed");
}
