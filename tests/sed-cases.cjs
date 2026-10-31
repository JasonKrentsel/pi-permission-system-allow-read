// Decision-only cases. None of these proposed commands are executed.
module.exports = async function sedCases({test,cwd,outside}) {
  const readers = [
    "sed -n '1,20p'", "sed -n '20,$p'", "sed -n '/TODO/p'",
    "sed 's/foo/bar/g'", "sed -E 's/(foo|bar)/x/g'", "sed -r 's/foo/bar/'",
    "sed '1,5d'", "sed '/^$/d'", "sed -n '1~2p'", "sed 'y/abc/ABC/'",
    "sed -ne '1,3p'", "sed -n -e '1p' -e '3p'", "sed --quiet --expression='1,3p'",
    "sed --expression 's/foo/bar/g'", "sed -nsu '1,3p'", "sed -z 's/foo/bar/g'",
    "sed -n '1,5{p;d;}'", "sed ':again;N;$!b again;s/\\n/ /g'",
    "sed -n '/start/,/end/p'", "sed -n '\\|foo|p'", "sed 's#foo#bar#g'",
    "sed 's/foo/write execute r w e/'", "sed 's/foo/a > b/'", "sed 's/foo/-i --in-place/'",
    "sed 's/foo/;w out/'", "sed 's/foo/;e echo/'", "sed 's/foo/[]/'",
    "sed ''", "sed -n -- '1p'", "sed --sandbox -n '1p'", "sed -n 'p;# w out'",
    "sed -n '1p\n2p'", "sed -n 'h;g;p'", "sed -n '1q'", "sed -n '/foo/!p'"
  ];
  const quote = s => "'"+s.replaceAll("'", "'\\''")+"'";
  for (const reader of readers) for (const target of ['src/a.txt',quote(cwd+'/src/a.txt')]) {
    const command=reader+' '+target;
    await test('read-only sed',command,'bash',{command},{state:'allow',prompts:0});
  }
  for(const reader of readers) for(const wrap of [s=>'echo hello | '+s,s=>'cd . && '+s,s=>'echo "$('+s+')"']) {
    const command=wrap(reader);
    await test('read-only sed compositions',command,'bash',{command},{state:'allow',prompts:0});
  }
  const unproven = [
    "sed -i 's/a/b/'", "sed -i.bak 's/a/b/'", "sed -ni 'p'", "sed -Ei 's/a/b/'",
    "sed --in-place 's/a/b/'", "sed --in-place=.bak 's/a/b/'", "sed --in 's/a/b/'",
    "sed --in-p 's/a/b/'", "sed -e 'p' -i", "sed -e 'p' -i.bak",
    "sed --sandbox -i 's/a/b/'", "sed --sandbox --in-place 's/a/b/'",
    "sed 'w out.txt'", "sed 'W out.txt'", "sed -n '1w out.txt'",
    "sed '/foo/w out.txt'", "sed 's/a/b/w out.txt'", "sed 's#a#b#gw out.txt'",
    "sed 's/a/b/W out.txt'", "sed 's/a/b/ep'", "sed 's/a/b/pe'", "sed 's/a/b/ge'",
    "sed 'e echo out'", "sed '1e echo out'", "sed 's/a/echo out/e'", "sed 'e'",
    "sed 'p;w out.txt'", "sed 'p\nw out.txt'", "sed '1{w out.txt\n}'",
    "sed -e 'p' -e 'w out.txt'", "sed -e 'w out.txt' -e 'p'",
    "sed -e 's/a/b/' --expression='e echo out'", "sed 'w /dev/null'",
    "sed 'r hidden.txt'", "sed 'R hidden.txt'", "sed '1r hidden.txt'",
    "sed -f script.sed", "sed -fscript.sed", "sed --file script.sed", "sed --file=script.sed",
    "sed --sandbox -f script.sed", "sed --sandbox 'w out.txt'",
    "sed --unknown 'p'", "sed --qui 'p'", "sed -l 70 'p'", "sed -n",
    "sed \"$SCRIPT\"", "sed -n '1p' \"$FILE\"", "sed -e \"$SCRIPT\"",
    "sed $(echo p)", "sed 'p' src/*.txt", "sed 'a hello'", "sed 'i hello'", "sed 'c hello'",
    "sed 'v'", "sed 's/a/b/X'", "sed 's/a/b'", "sed '1{p'", "sed 'swawew'"
  ];
  for (const invocation of unproven) for(const wrap of [s=>s,s=>'echo hello | '+s,s=>s+' src/a.txt',s=>'cd . && '+s,s=>'echo "$('+s+')"']) {
    const command=wrap(invocation);
    await test('sed writing execution or unproven',command,'bash',{command},{state:'not-allow'});
  }
  for (const reader of ["sed -n '1p' src/a.txt","echo hello | sed 's/foo/bar/g'"]) {
    for(const op of ['>','>>','>|','2>','&>'])for(const destination of ['out.txt','"$OUTPUT"','$(echo out)']) {
      const command=reader+' '+op+' '+destination;
      await test('sed output writes',command,'bash',{command},{state:'ask'});
    }
    for(const op of ['>','2>','>>']) {
      const command=reader+' '+op+' /dev/null';
      await test('sed discard redirect',command,'bash',{command},{state:'allow',prompts:0});
    }
  }
  for(const target of ['.env','certs/server.pem','certs/server.crt']) {
    const command="sed -n '1p' "+target;
    await test('sed explicit secret',command,'bash',{command},{state:'deny',prompts:0});
  }
  const outsideCommand="sed -n '1p' "+quote(outside+'/outside.txt');
  await test('sed outside read',outsideCommand,'bash',{command:outsideCommand},{state:'ask'});
  for(const command of ["sed 'p' src/a.txt -i","sed -e 'p' src/a.txt --in-place","echo hi | sed 'p' | sed 'w out'","sed 'w out' <<'EOF'\nhello\nEOF","sed 'e echo out' <<< hello","env sed 'w out'","command sed 'w out'","find src -exec sed 'w out' {} +"])await test('sed option permutation and wrappers',command,'bash',{command},{state:'not-allow'});
};
