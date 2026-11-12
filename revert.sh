#!/bin/bash

# Copyright (c) 2024 Alex313031.

YEL='\033[1;33m' # Yellow
CYA='\033[1;96m' # Cyan
RED='\033[1;31m' # Red
GRE='\033[1;32m' # Green
c0='\033[0m' # Reset Text
bold='\033[1m' # Bold Text
underline='\033[4m' # Underline Text

# Error handling
yell() { echo "$0: $*" >&2; }
die() { yell "$*"; exit 111; }
try() { "$@" || die "${RED}Failed $*"; }

# --help
displayHelp () {
	printf "\n" &&
	printf "${bold}${GRE}Script to restore the Mozilla repo to a vanilla state.${c0}\n" &&
	printf "${bold}${YEL}Useful for making changes without updating the Firefox version.${c0}\n" &&
	printf "\n"
}
case $1 in
	--help) displayHelp; exit 0;;
esac

# mozilla source dir env variable
# NOTE: Mozilla moved Firefox development from Mercurial (mozilla-unified) to
# git (https://github.com/mozilla-firefox/firefox) in 2025. HG_SRC_DIR keeps its
# old name for compatibility, but it must now point at a git checkout of
# mozilla-firefox/firefox (e.g. created by ./bootstrap.sh).
if [ -z "${HG_SRC_DIR}" ]; then 
    HG_SRC_DIR="$HOME/mozilla-unified"
    export HG_SRC_DIR
else 
    HG_SRC_DIR="${HG_SRC_DIR}"
    export HG_SRC_DIR
fi

# Refuse to run destructive commands anywhere but a Firefox git checkout.
if [ ! -f "${HG_SRC_DIR}/mach" ] || [ ! -d "${HG_SRC_DIR}/.git" ]; then
	printf "${RED}${HG_SRC_DIR} is not a git checkout of Firefox (missing ./mach or .git). Aborting.${c0}\n"
	exit 1
fi

printf "\n" &&
printf "${bold}${GRE}Script to restore the Mozilla repo to a vanilla state.${c0}\n" &&
printf "${bold}${YEL}Useful for making changes without updating the Firefox version.${c0}\n" &&
printf "\n" &&
printf "${YEL}Removing/reverting changes made by Mercury to the Mozilla repo...${c0}\n" &&

cd "${HG_SRC_DIR}" &&

rm -r -f ./obj-* &&

git clean -fd &&

git checkout --force -- . &&

printf "\n" &&
printf "${GRE}Done! ${YEL}You can now run ./setup.sh or make changes.\n" &&
tput sgr0
