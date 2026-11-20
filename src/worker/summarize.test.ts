import { assert, test } from 'orca/testing'
import { familyOf, mask, shortPath, summarizeTool, toolLabel } from './summarize'

test('masks common credential shapes', () => {
  const cases: [string, string][] = [
    ['curl -H "Authorization: ' + 'Bearer abcd' + 'efghijklmnop" x', 'curl -H "Authorization: Bearer ***" x'],
    ['export API_KEY=sk-ant-' + 'api03-abcdefghijkl', 'export API_KEY=***'],
    ['psql postgres://admin:hunter2@db:5432/app', 'psql postgres://admin:***@db:5432/app'],
    ['git push https://x:ghp_' + 'aaaaaaaaaaaaaaaaaaaaaaaa@github.com', 'git push https://x:***@github.com'],
    ['echo ghp_' + 'abcdefghijklmnopqrstuvwx', 'echo ***'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abcdefghijklmno', 'jwt ***'],
    ['aws AKIA' + 'ABCDEFGHIJKLMNOP', 'aws ***'],
    ['https://hooks.example.com/x?key=abc123&token=def456', 'https://hooks.example.com/x?key=***&token=***'],
    ['{"password": "p@ss"}', '{"password": ***}'],
    ['PGPASSWORD=s3cret psql', 'PGPASSWORD=*** psql'],
    ['mysql --password hunter2xyz db', 'mysql --password *** db'],
    ['mysql -uroot -phunter2', 'mysql -uroot -p***'],
    ['docker login -p dckr_' + 'pat_abcdefghijklmnop', 'docker login -p ***'],
    ['curl -u admin:' + 'S3cretPassw0rd https://x', 'curl -u admin:*** https://x'],
    ['aws configure set aws_secret_access_key wJalrXUtnFEMI', 'aws configure set aws_secret_access_key ***'],
    ['stripe sk_' + 'live_abcdefghijklmnop', 'stripe ***'],
    ['NPM_TOKEN=npm_' + 'abcdefghijklmnopqrstuvwx', 'NPM_TOKEN=***'],
    ['curl https://hooks.slack.com/' + 'services/T000/B000/XXXX', 'curl https://hooks.slack.com/services/***'],
    ['{"sessionToken": "abc"}', '{"sessionToken": ***}']
  ]
  for (const [input, want] of cases) assert.equal(mask(input), want, input)
})

test('masks hyphenated header names and login-style flags', () => {
  assert.equal(mask('curl -H "X-Api-' + 'Key: abcd' + '1234efgh5678" https://x'), 'curl -H "X-Api-Key: ***" https://x')
  assert.equal(mask("curl -H 'x-auth-token: abc123' u"), "curl -H 'x-auth-token: ***' u")
  assert.equal(mask('sshpass -p hunter2 ssh host'), 'sshpass -p *** ssh host')
  assert.equal(mask('redis-cli -a hunter2 ping'), 'redis-cli -a *** ping')
})

test('leaves ordinary commands alone', () => {
  for (const s of ['npm test -- --watch', 'git log --oneline -5', 'ls -la src/keyboard', 'grep -rn monkey src/', 'git log --author=alice', 'sort --key=2 f', 'design=compact', 'grep "sessionId: 12" log', 'mkdir -p build/out'])
    assert.equal(mask(s), s)
})

test('summaries per tool', () => {
  assert.equal(summarizeTool('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests')
  assert.equal(summarizeTool('Bash', { command: 'TOKEN=abc npm run x' }), 'TOKEN=*** npm run x')
  assert.equal(summarizeTool('Read', { file_path: '/work/app/src/a.ts' }, '/work/app'), 'src/a.ts')
  assert.equal(summarizeTool('Read', { file_path: '/elsewhere/deep/dir/a.ts' }, '/work/app'), '…/dir/a.ts')
  assert.equal(summarizeTool('Grep', { pattern: 'foo', path: '/work/app/src' }, '/work/app'), 'foo in src')
  assert.equal(summarizeTool('WebFetch', { url: 'https://example.com/a/b?sig=xyz' }), 'example.com/a/b')
  assert.equal(summarizeTool('WebFetch', { url: 'https://admin:Sup3rS3cret@internal.example.com/api' }), 'admin:***@internal.example.com/api')
  assert.equal(summarizeTool('Agent', { subagent_type: 'Explore', description: 'Find it' }), 'Explore: Find it')
  assert.equal(summarizeTool('mcp__github__get_issue', {}), 'github · get_issue')
  assert.ok(summarizeTool('Bash', { command: 'x'.repeat(300) }).length <= 90)
})

test('families, labels and paths', () => {
  assert.equal(familyOf('Edit'), 'file')
  assert.equal(familyOf('Bash'), 'shell')
  assert.equal(familyOf('WebSearch'), 'web')
  assert.equal(familyOf('mcp__x__y'), 'mcp')
  assert.equal(familyOf('Agent'), 'agent')
  assert.equal(familyOf('TodoWrite'), 'other')
  assert.equal(toolLabel('mcp__chrome__take_screenshot'), 'chrome.take_screenshot')
  assert.equal(shortPath('/a/b'), '/a/b')
})

test('masking stays fast on long runs without delimiters', () => {
  for (const s of ['cfg' + '.api_key'.repeat(8000), 'a.sessionToken.authKey.'.repeat(3000), 'key'.repeat(130_000)]) {
    const t0 = performance.now()
    mask(s)
    assert.ok(performance.now() - t0 < 50, `took ${performance.now() - t0} ms`)
  }
})
