// Permission simulations only; proposed shell commands are never executed.
module.exports = async function findForCases({test}) {
  for (const command of [
    "find . -type f", "find src -name '*.ts'", "find . -type d -maxdepth 2",
    "find src -type f -print", "find src -type f -print0", "find src -type f -ls",
    "find src -printf '%p\\n'", "find -name '*.ts'", "find -print", "find -print0",
    "find src -type f | head -n 10", "cd . && find src -type f",
    "echo \"$(find src -name '*.ts')\""
  ]) await test('read-only find',command,'bash',{command},{state:'allow',prompts:0});
  for(const invocation of [
    "find -delete", "find -depth -delete", "find -fprint out.txt", "find -fprint0 out.txt",
    "find -fprintf out.txt '%p\\n'", "find -fls out.txt", "find -files0-from paths.txt -delete",
    "find . -delete", "find src -name '*.txt' -delete", "find src -fprint out.txt",
    "find src -exec rm {} \\;", "find -exec rm {} +", "find -execdir rm {} +",
    "find -ok rm {} \\;", "find -okdir rm {} \\;", "find \"$FLAGS\"", "find ${FLAGS}",
    "find -exec sh -c 'echo x > out.txt' \\;", "find src -exec sed -i 's/a/b/' {} +",
    "find src -exec sed 'w out.txt' {} +"
  ]) for(const wrap of [s=>s,s=>'echo checking; '+s,s=>'echo \"$('+s+')\"']) {
    const command=wrap(invocation);
    await test('find write execution or unresolved',command,'bash',{command},{state:'not-allow'});
  }
  for(const command of [
    'for f in src/a.txt; do cat "$f"; done',
    'for f in src/*.txt; do echo "$f"; done',
    'for ((i=0;i<3;i++)); do echo "$i"; done',
    'for f; do echo "$f"; done',
    'for f in src/a.txt; do sed -n "1p" "$f"; done',
    'for f in $(find src -type f); do cat "$f"; done',
    'echo reading; for f in src/a.txt; do cat "$f"; done'
  ]) await test('read-only for remains reviewable',command,'bash',{command},{state:'ask'});
  for(const command of [
    'for f in src/a.txt; do rm "$f"; done',
    'for f in src/a.txt; do echo x > "$f"; done',
    'for f in src/a.txt; do sed -i "s/a/b/" "$f"; done',
    'for f in src/a.txt; do sed "w out.txt" "$f"; done',
    'for f in $(find -delete); do echo "$f"; done',
    'for f in $(echo x > out.txt); do echo "$f"; done',
    'for f in src/a.txt; do for g in src/example.ts; do rm "$g"; done; done',
    'for f in .env; do cat "$f"; done',
    'for f in src/a.txt; do cat .env; done',
    'for f in src/a.txt; do echo x; done > out.txt',
    'for f in src/a.txt; do echo x; done > "$OUTPUT"'
  ]) await test('for write execution or secret',command,'bash',{command},{state:'not-allow'});
};
