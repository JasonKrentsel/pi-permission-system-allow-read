# Pi permission system: allow reads, ask for writes

A personal configuration for [gotgenes/pi-permission-system](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system), tested with **41.0.0** and **Pi 1.4.0** on Windows.

The goal is to keep ordinary exploration quick while giving the user a moment to review changes and complex commands.

Use the configuration together with the source patch below. The `cd *` and `sed *` rules rely on that patch to keep unresolved directory changes and unproven sed programs asking.

## Behavior

| Operation | Decision |
| --- | --- |
| Read, grep, find, or list ordinary files inside the current directory tree | Allow |
| Listed read-only Bash commands and ordinary Git inspection | Allow |
| Recognized read-only `sed` programs, including printing ranges, filtering, and stdout substitutions | Allow |
| `sed` in-place edits, program-level writes/execution, script files, computed arguments, or unrecognized syntax | Ask |
| Literal `cd` into the current project, including Git Bash `/c/...` and `/C/...` drive paths | Allow; the rest of the command is checked separately |
| `cd` outside the project or an unresolved destination such as `cd "$DIR"` | Ask |
| Formatting with `echo`, including arbitrary strings | Allow |
| Write or edit an ordinary project file | Ask once |
| Literal redirects to ordinary output files | Ask |
| Literal `/dev/null`, `/dev/stdout`, or `/dev/stderr` destinations | Allow |
| Access outside the current directory tree | Ask; outside writes can encounter an additional boundary prompt |
| Explicitly named `.env`, certificates, private keys, and listed credential paths | Deny |
| Unknown tools, scripts, installs, tests, PowerShell commands, or unlisted Bash commands | Ask |

`write` and `edit` are allowed at the tool surface because `path_write` supplies the approval. Asking at both surfaces produces duplicate prompts. Keep the path rules when modifying this configuration.

Manual approval is enabled, automatic authorizers and YOLO mode are disabled, and approval requires confirmation. Permission review logging is enabled; logs are local and excluded from this repository.

## Install the configuration

Install the matching upstream extension:

```text
pi install npm:@gotgenes/pi-permission-system@41.0.0
```

Copy this repository's `config.json` to:

```text
~/.pi/agent/extensions/pi-permission-system/config.json
```

For example, in PowerShell from this repository:

```powershell
$permissionDirectory = Join-Path $env:USERPROFILE '.pi/agent/extensions/pi-permission-system'
New-Item -ItemType Directory -Force -Path $permissionDirectory | Out-Null
Copy-Item -LiteralPath ./config.json -Destination (Join-Path $permissionDirectory 'config.json')
```

Apply the source patch below as part of this setup, then restart Pi. Project-specific policies and session approvals can change the effective decisions.

## Source patch: computed redirects, directory changes, and sed

The JSON alone cannot enforce the intended behavior for computed redirects, unresolved directory changes, or sed scripts in upstream 41.0.0. This repository includes the local source patch used with this configuration. For example, these computed writes must ask:

```bash
cat README.md > "$OUTPUT"
cat README.md > $(echo output.txt)
```

An otherwise allowed command with an unresolved output destination asks for approval and displays the complete command. Literal `/dev/null` remains allowed. The check uses the existing Bash syntax tree; a quoted string that merely contains `>` is not treated as a redirect. Existing denies and user session grants retain precedence.

The `cd *` configuration rule avoids asking just because a model prefixes a read-only command with a full-path `cd` to the project. The ordinary path and boundary gates still check the destination. The source patch also keeps unresolved destinations, `cd -`, missing destinations, and globs asking rather than letting them inherit that broad rule. Install the patch along with the JSON to retain this behavior.

For example, `cd "/c/path/to/project" && ls` is allowed when that resolves inside the current project; changing to a sibling project still asks. `/mnt/c/...` is a WSL spelling, not a Git Bash drive mount, and retains the boundary prompt on this Git Bash setup.

### Read-only sed

The patch reuses upstream 41.0.0's `sedWithdrawsReadClaim` allowlist grammar. The entire literal argument list and every inline script must be recognized as read-only; a blacklist of just `-i` would miss script-level writes and execution. No sed command is rewritten or executed by this permission check.

These examples are allowed for ordinary project files:

```bash
sed -n '1,80p' file.txt
sed '/^$/d' file.txt
sed 's/foo/bar/g' file.txt
sed -E -e 's/(foo|bar)/x/g' file.txt
```

The following ask:

- `-i`, backup suffixes, option clusters, `--in-place`, and abbreviated/unknown options.
- `w`/`W`, substitution write flags, `e`, and substitution execution flags.
- `-f`/`--file`, additional-file reads through `r`/`R`, computed arguments, globs, malformed scripts, and syntax outside the upstream grammar. Some harmless commands therefore still ask.
- Shell output redirects to ordinary files, including computed destinations; literal `/dev/null` remains allowed.

This applies to stdin pipelines and nested command substitutions too, where there may be no input filename for the path gate to inspect. Explicit secret input files remain denied and outside-project inputs ask. `--sandbox` does not waive the checks; for example, `sed --sandbox -i ...` still asks. See the [GNU sed documentation](https://www.gnu.org/software/sed/manual/sed.html) for sed's separate file-writing and execution facilities.

Check or apply the patch with Node.js:

```text
node scripts/patch-computed-redirects.mjs --check
node scripts/patch-computed-redirects.mjs --apply
```

The default package location is `~/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system`. Pass a different package directory as an argument, or set `PI_PERMISSION_PACKAGE`. The script checks the package version and exact source hashes before writing, is safe to reapply, upgrades earlier versions of this patch, and supports `--revert`. Restart Pi afterward. Reinstalling or upgrading the upstream package can overwrite this local patch. If reverting the patch, also remove the `cd *` and `sed *` allow rules to restore prompts for those commands.

This is a configuration and a local patch, not an upstream release or a separate permission extension. The patch modifies four upstream source files; it does not change the JSON policy.

## Accepted behavior and scope

- Broad session approvals may supersede secret-file denies. This is intentional for this setup.
- Windows alternate-stream file aliases are not covered by the secret patterns. Their existing behavior is intentional for this setup.
- Explicit secret filenames are checked, but recursive searches, shell globs, and unresolved variable reads can reach contents without explicitly naming those filenames. This is a review-oriented permission configuration, not filesystem isolation.
- `.env.example` and other names matched by `*.env.*` are denied too.
- PowerShell and unconfigured alternative shell tools ask, but do not receive Bash-specific path analysis.

## Verification

The decision-level regression suite contains **3,066 checks** when junction fixtures are available, including 518 sed cases, 267 computed-redirect cases, 72 literal `/dev/null` cases, 47 directory-change cases, and 126 ordinary in-project edit/write path variants that each ask exactly once. Six junction checks are skipped if local permissions prevent creating those fixtures. Alias and session tests assert the accepted behavior above. Pi startup was also checked with the patched extension.

Run the suite against your installed extension:

```text
node tests/audit.cjs
```

It defaults to the managed Pi 1.4.0 installation under `~/.pi/agent/install/releases/1.4.0/node_modules`. Set `PI_NODE_MODULES` to the directory containing your Pi SDK, pi-tui, and jiti dependencies when using another layout. Set `PI_PERMISSION_PACKAGE` for a different extension location. An optional first argument selects a different configuration file.

The suite creates synthetic fixtures and writes its report under `.test-artifacts/`, which Git ignores. It uses the installed parser, policy loader, gate pipeline, and GateRunner with simulated human decisions. Proposed shell commands and file tools are not executed; there are no model requests. Junction checks require permission to create local junctions. This finite regression suite does not prove behavior for every possible shell program.

Upstream extension code and APIs belong to the gotgenes project. Its MIT license is preserved in `patches/UPSTREAM-LICENSE` for the upstream snippets included in the patch specification. This repository publishes a personal policy, a small patch specification, and its regression harness; it contains no user sessions or permission logs.
