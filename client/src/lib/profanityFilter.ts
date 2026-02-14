const BLOCKED_WORDS = [
  'fuck','shit','ass','bitch','damn','dick','cock','pussy','cunt',
  'fag','faggot','retard','retarded','nigger','nigga','negro',
  'spic','chink','gook','kike','wetback','beaner','cracker',
  'whore','slut','twat','wanker','prick','bastard','bollocks',
  'arse','tit','tits','boob','penis','vagina','anal','cum',
  'jizz','dildo','homo','dyke','tranny','rape','rapist',
  'nazi','hitler','kkk','jihad',
];

const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

function normalizeName(name: string): string {
  let normalized = name.toLowerCase();
  for (const [leet, letter] of Object.entries(LEET_MAP)) {
    normalized = normalized.split(leet).join(letter);
  }
  normalized = normalized.replace(/[^a-z]/g, '');
  return normalized;
}

export function containsProfanity(name: string): boolean {
  const normalized = normalizeName(name);
  for (const word of BLOCKED_WORDS) {
    if (normalized.includes(word)) {
      return true;
    }
  }
  return false;
}
