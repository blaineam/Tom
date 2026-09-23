// Tom 🦎 — branding: the tokay gecko who sings + a tiny ANSI palette.
// Geckos are among the only lizards with a voice; the tokay gecko is named
// after its own call ("to-KAY!"). Tom writes the music: Monkr frames the
// pictures, Tom sings the soundtrack.

const isTTY = process.stdout.isTTY;
const E = (n) => (s) => (isTTY ? `\x1b[${n}m${s}\x1b[0m` : `${s}`);
export const c = {
  bold: E(1), dim: E(2), italic: E(3),
  red: E(31), green: E(32), yellow: E(33), blue: E(34),
  magenta: E(35), cyan: E(36), gray: E(90),
  // Tom's palette: tokay blue-grey scales, orange spots, gold eyes.
  scale: E('38;5;110'), spot: E('38;5;209'), eye: E('38;5;220'),
};

export function mascot() {
  const { scale, spot, eye, bold, dim } = c;
  return [
    '',
    scale('             _.-._') + '          ' + spot('♪'),
    scale('          .-\'  ') + eye('◉') + scale('  \'>') + '   ' + spot('♫') + '      ' + bold(scale('T O M')),
    scale('   __.--\'  ') + spot('●') + scale(' ') + spot('●') + scale(' .-\'') + '             ' + eye('music for your apps, on demand'),
    scale('  (__.-\'\\_\\__/_/-\'') + '               ' + dim('"to-KAY! that\'s gecko for \'hit record\'."'),
    scale('        /_/  /_/') + '                ' + spot('🦎 seeded · parameterized · royalty-free'),
    '',
  ].join('\n');
}

export const tag = c.scale(c.bold('🦎 tom'));
export const ok = (s) => console.log(`${c.green('✓')} ${s}`);
export const info = (s) => console.log(`${c.eye('▸')} ${s}`);
export const warn = (s) => console.log(`${c.yellow('⚠')} ${s}`);
export const err = (s) => console.error(`${c.red('✗')} ${s}`);
export const step = (s) => console.log(`\n${c.scale('▶')} ${c.bold(s)}`);
export const quip = (s) => console.log(c.dim(c.italic(`   🦎 ${s}`)));

export const quips = {
  start: ['warming up the vocal sac.', 'to-kay. to-kay. (that was the tuning.)', 'sticky feet on the keys.'],
  done: ['to-KAY! that means done.', 'one song, fresh from the terrarium.', 'licked my own eyeball. ship it.'],
};
export const pick = (arr) => arr[Math.floor(Math.abs(Math.sin(Date.now() / 9973)) * arr.length) % arr.length];
