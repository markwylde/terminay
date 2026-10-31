/**
 * The shell integration scripts (ADR-0082), written into the server's private
 * shell-integration directory before a terminal uses them. They are fixed
 * text: no part of a script is built from settings, profiles, or extension
 * data, which reach the shell only as `TERMINAY_` environment values that the
 * scripts read as data.
 *
 * Each script follows VS Code's terminal shell integration
 * (src/vs/workbench/contrib/terminal/common/scripts), MIT License,
 * Copyright (c) Microsoft Corporation.
 */

export const SHELL_INTEGRATION_SCRIPTS = Object.freeze({
	/** `terminay.bash` */
	bash: `# Terminay shell integration for bash (ADR-0082). Terminay starts bash with
# --init-file pointing here, so this file loads the user's own startup files
# first and then defines Terminay's command defaults. The approach follows
# VS Code's shellIntegration-bash.sh (MIT License, Copyright (c) Microsoft
# Corporation).

if [ -n "\${__terminay_shell_integration_ran-}" ]; then
	builtin return 0
fi
__terminay_shell_integration_ran=1

# --init-file replaces ~/.bashrc and cannot be combined with -l, so a login
# start is imitated: /etc/profile, then the first of the user's login files.
if [ -n "\${TERMINAY_SHELL_LOGIN-}" ]; then
	builtin unset TERMINAY_SHELL_LOGIN
	if [ -r /etc/profile ]; then
		. /etc/profile
	fi
	if [ -r ~/.bash_profile ]; then
		. ~/.bash_profile
	elif [ -r ~/.bash_login ]; then
		. ~/.bash_login
	elif [ -r ~/.profile ]; then
		. ~/.profile
	fi
else
	if [ -r ~/.bashrc ]; then
		. ~/.bashrc
	fi
fi
builtin unset TERMINAY_SHELL_INTEGRATION

__terminay_command_default_names=()

# Runs a command default: the command found on PATH, never a function or
# alias, with the default's flags before the user's arguments.
__terminay_run_command_default() {
	local __terminay_index=$1
	shift
	case $__terminay_index in
	'' | *[!0-9]*) return 127 ;;
	esac
	eval "set -- \\"\\\${__terminay_command_default_args_\${__terminay_index}[@]}\\" \\"\\$@\\""
	command "\${__terminay_command_default_names[$__terminay_index]}" "$@"
}

# Reads TERMINAY_COMMAND_DEFAULTS: records split by ASCII RS, and in each the
# command then its flags split by ASCII US. Values are only ever expanded as
# data; the only text given to eval is a checked name and a number.
__terminay_define_command_defaults() {
	local raw="\${TERMINAY_COMMAND_DEFAULTS-}"
	builtin unset TERMINAY_COMMAND_DEFAULTS
	[ -n "$raw" ] || return 0
	local rs=$'\\x1e' us=$'\\x1f' pattern='^[A-Za-z0-9_][A-Za-z0-9._-]*$'
	local rest="$raw$rs" record fields name arg index valid
	local -a args
	while [ -n "$rest" ]; do
		record=\${rest%%"$rs"*}
		rest=\${rest#*"$rs"}
		name=\${record%%"$us"*}
		[ "$name" != "$record" ] || continue
		[[ $name =~ $pattern ]] || continue
		fields=\${record#*"$us"}$us
		args=()
		valid=1
		while [ -n "$fields" ]; do
			arg=\${fields%%"$us"*}
			fields=\${fields#*"$us"}
			case $arg in
			-*) args[\${#args[@]}]=$arg ;;
			*) valid=0 ;;
			esac
		done
		[ "$valid" = 1 ] || continue
		# The user's own alias or function of that name wins.
		case $(builtin type -t "$name" 2>/dev/null) in
		alias | function | builtin | keyword) continue ;;
		esac
		index=\${#__terminay_command_default_names[@]}
		__terminay_command_default_names[$index]=$name
		eval "__terminay_command_default_args_\${index}=(\\"\\\${args[@]}\\")"
		eval "$name() { __terminay_run_command_default $index \\"\\$@\\"; }" 2>/dev/null
	done
	return 0
}
__terminay_define_command_defaults
builtin unset -f __terminay_define_command_defaults
`,
	/** `terminay.fish` */
	fish: `# Terminay shell integration for fish (ADR-0082). Terminay starts fish with
# --init-command sourcing this file, which fish runs after the user's own
# configuration. The approach follows VS Code's shellIntegration.fish (MIT
# License, Copyright (c) Microsoft Corporation).

if set -q __terminay_shell_integration_ran
    return
end
set -g __terminay_shell_integration_ran 1
set -e TERMINAY_SHELL_INTEGRATION

# Runs a command default: the command found on PATH, never a function, with
# the default's flags before the user's arguments.
function __terminay_run_command_default
    set -l index $argv[1]
    string match -qr '^[0-9]+$' -- "$index"; or return 127
    set -l name $__terminay_command_default_names[(math $index + 1)]
    set -l defaults __terminay_command_default_args_$index
    command $name $$defaults $argv[2..-1]
end

# Reads TERMINAY_COMMAND_DEFAULTS: records split by ASCII RS, and in each the
# command then its flags split by ASCII US. Values are only ever used as data.
function __terminay_define_command_defaults
    set -l raw "$TERMINAY_COMMAND_DEFAULTS"
    set -e TERMINAY_COMMAND_DEFAULTS
    test -n "$raw"; or return 0
    set -g __terminay_command_default_names
    for record in (string split -- \\x1e "$raw")
        set -l fields (string split -- \\x1f "$record")
        set -q fields[2]; or continue
        set -l name $fields[1]
        string match -qr '^[A-Za-z0-9_][A-Za-z0-9._-]*$' -- "$name"; or continue
        set -l valid 1
        for arg in $fields[2..-1]
            string match -q -- '-*' "$arg"; or set valid 0
        end
        test $valid = 1; or continue
        # The user's own function of that name wins.
        functions -q -- $name; and continue
        contains -- $name (builtin --names); and continue
        set -l index (count $__terminay_command_default_names)
        set -ga __terminay_command_default_names $name
        set -g __terminay_command_default_args_$index $fields[2..-1]
        function $name --inherit-variable index
            __terminay_run_command_default $index $argv
        end
    end
end
__terminay_define_command_defaults
functions -e __terminay_define_command_defaults
`,
	/** `terminay.ps1` */
	powershell: `# Terminay shell integration for PowerShell (ADR-0082). Terminay starts
# PowerShell with -NoExit -Command dot-sourcing this file, which runs after the
# user's profiles. The approach follows VS Code's shellIntegration.ps1 (MIT
# License, Copyright (c) Microsoft Corporation).

if ((Test-Path variable:global:__TerminayShellIntegration) -or
	$ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
	return
}
$Global:__TerminayShellIntegration = $true
$__terminayRaw = $env:TERMINAY_COMMAND_DEFAULTS
Remove-Item -Path Env:TERMINAY_COMMAND_DEFAULTS, Env:TERMINAY_SHELL_INTEGRATION -ErrorAction SilentlyContinue

# Reads the command defaults: records split by ASCII RS, and in each the
# command then its flags split by ASCII US. Each becomes a function that runs
# the application found on PATH, never an alias or function, with the
# default's flags before the user's arguments. Values are only used as data.
if ($__terminayRaw) {
	foreach ($__terminayRecord in $__terminayRaw.Split([char]0x1e)) {
		$__terminayFields = $__terminayRecord.Split([char]0x1f)
		if ($__terminayFields.Count -lt 2) { continue }
		$__terminayName = $__terminayFields[0]
		if ($__terminayName -cnotmatch '^[A-Za-z0-9_][A-Za-z0-9._-]*$') { continue }
		$__terminayDefaults = @($__terminayFields[1..($__terminayFields.Count - 1)])
		if (@($__terminayDefaults | Where-Object { -not $_.StartsWith('-') }).Count -gt 0) { continue }
		# The user's own alias or function of that name wins.
		if (Get-Command -Name $__terminayName -CommandType Alias, Function, Cmdlet -ErrorAction SilentlyContinue) { continue }
		$__terminayFunction = & {
			param($Name, $Defaults)
			{
				$application = Get-Command -Name $Name -CommandType Application, ExternalScript -ErrorAction Stop |
					Select-Object -First 1
				& $application @Defaults @args
			}.GetNewClosure()
		} $__terminayName $__terminayDefaults
		Set-Item -Path "Function:global:$__terminayName" -Value $__terminayFunction
	}
}
Remove-Variable -Name __terminayRaw, __terminayRecord, __terminayFields, __terminayName, __terminayDefaults, __terminayFunction -ErrorAction SilentlyContinue
`,
	/** `zsh/.zshenv` */
	zshEnv: `# Terminay shell integration for zsh (ADR-0082). Terminay starts zsh with
# ZDOTDIR pointing at this directory. Each file here sources the user's file of
# the same name first, with ZDOTDIR set to the user's directory while it runs,
# so zsh reads every startup file in its normal order. The approach follows
# VS Code's shellIntegration-*.zsh (MIT License, Copyright (c) Microsoft
# Corporation).

if [[ -z \${__terminay_zdotdir-} ]]; then
	__terminay_zdotdir=$ZDOTDIR
	if (( \${+TERMINAY_USER_ZDOTDIR} )); then
		__terminay_user_zdotdir=$TERMINAY_USER_ZDOTDIR
		__terminay_user_zdotdir_given=1
	else
		__terminay_user_zdotdir=$HOME
		__terminay_user_zdotdir_given=0
	fi
	builtin unset TERMINAY_USER_ZDOTDIR
fi
if [[ $__terminay_user_zdotdir != $__terminay_zdotdir && -f $__terminay_user_zdotdir/.zshenv ]]; then
	ZDOTDIR=$__terminay_user_zdotdir
	builtin source "$__terminay_user_zdotdir/.zshenv"
	__terminay_user_zdotdir=\${ZDOTDIR:-$HOME}
	ZDOTDIR=$__terminay_zdotdir
fi
`,
	/** `zsh/.zprofile` */
	zshProfile: `# Terminay shell integration for zsh: the user's .zprofile (ADR-0082).
if [[ $__terminay_user_zdotdir != $__terminay_zdotdir && -f $__terminay_user_zdotdir/.zprofile ]]; then
	ZDOTDIR=$__terminay_user_zdotdir
	builtin source "$__terminay_user_zdotdir/.zprofile"
	__terminay_user_zdotdir=\${ZDOTDIR:-$HOME}
	ZDOTDIR=$__terminay_zdotdir
fi
`,
	/** `zsh/.zshrc` */
	zshRc: `# Terminay shell integration for zsh: the user's .zshrc, then Terminay's
# command defaults (ADR-0082).

# A system zshrc that names its history file after ZDOTDIR saw this directory.
if [[ \${HISTFILE-} == $__terminay_zdotdir/.zsh_history ]]; then
	HISTFILE=$__terminay_user_zdotdir/.zsh_history
fi
if [[ $__terminay_user_zdotdir != $__terminay_zdotdir && -f $__terminay_user_zdotdir/.zshrc ]]; then
	ZDOTDIR=$__terminay_user_zdotdir
	builtin source "$__terminay_user_zdotdir/.zshrc"
	__terminay_user_zdotdir=\${ZDOTDIR:-$HOME}
	ZDOTDIR=$__terminay_zdotdir
fi

typeset -ga __terminay_command_default_names

# Runs a command default: the command found on PATH, never a function or
# alias, with the default's flags before the user's arguments.
__terminay_run_command_default() {
	builtin emulate -L zsh
	local index=$1
	shift
	[[ $index == <-> ]] || return 127
	local -a defaults
	defaults=("\${(@P)\${:-__terminay_command_default_args_$index}}")
	command "\${__terminay_command_default_names[index + 1]}" "\${defaults[@]}" "$@"
}

# Reads TERMINAY_COMMAND_DEFAULTS: records split by ASCII RS, and in each the
# command then its flags split by ASCII US. Values are only ever used as data.
() {
	builtin emulate -L zsh
	local raw=\${TERMINAY_COMMAND_DEFAULTS-}
	builtin unset TERMINAY_COMMAND_DEFAULTS
	[[ -n $raw ]] || return 0
	local rs=$'\\x1e' us=$'\\x1f' record name arg
	local -a fields
	local -i index
	for record in "\${(@ps:$rs:)raw}"; do
		fields=("\${(@ps:$us:)record}")
		(( \${#fields} > 1 )) || continue
		name=$fields[1]
		[[ $name =~ '^[A-Za-z0-9_][A-Za-z0-9._-]*$' ]] || continue
		for arg in "\${(@)fields[2,-1]}"; do
			[[ $arg == -* ]] || continue 2
		done
		# The user's own alias or function of that name wins.
		(( \${+aliases[$name]} || \${+functions[$name]} || \${+builtins[$name]} )) && continue
		index=\${#__terminay_command_default_names}
		__terminay_command_default_names+=("$name")
		typeset -ga "__terminay_command_default_args_$index"
		set -A "__terminay_command_default_args_$index" "\${(@)fields[2,-1]}"
		functions[$name]="__terminay_run_command_default $index \\"\\$@\\""
	done
}

if [[ ! -o login ]]; then
	builtin source "$__terminay_zdotdir/finish.zsh"
fi
`,
	/** `zsh/.zlogin` */
	zshLogin: `# Terminay shell integration for zsh: the user's .zlogin (ADR-0082).
if [[ $__terminay_user_zdotdir != $__terminay_zdotdir && -f $__terminay_user_zdotdir/.zlogin ]]; then
	ZDOTDIR=$__terminay_user_zdotdir
	builtin source "$__terminay_user_zdotdir/.zlogin"
	__terminay_user_zdotdir=\${ZDOTDIR:-$HOME}
	ZDOTDIR=$__terminay_zdotdir
fi
builtin source "$__terminay_zdotdir/finish.zsh"
`,
	/** `zsh/finish.zsh` */
	zshFinish: `# Terminay shell integration for zsh: hand ZDOTDIR back to the user once
# startup is over, so a nested zsh reads the user's files directly (ADR-0082).
if [[ $__terminay_user_zdotdir_given == 1 || $__terminay_user_zdotdir != $HOME ]]; then
	ZDOTDIR=$__terminay_user_zdotdir
else
	builtin unset ZDOTDIR
fi
builtin unset __terminay_zdotdir __terminay_user_zdotdir __terminay_user_zdotdir_given TERMINAY_SHELL_INTEGRATION
`,
});
