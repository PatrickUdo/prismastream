#!/usr/bin/env bash
# Deploys the committed HEAD to the VPS: exports the tree, uploads it, rebuilds and restarts the stack.
# Usage: [SERVICES="web"] deploy/deploy.sh [ssh-host]   (default root@vps.prisma-scripts.com, all services)
set -euo pipefail
HOST="${1:-root@vps.prisma-scripts.com}"
STACK=/opt/stacks/prismastream
REV=$(git rev-parse --short HEAD)
SERVICES="${SERVICES:-}"
if [ -n "$(git status --porcelain)" ]; then
	echo "Let op: er zijn niet-gecommitte wijzigingen; alleen HEAD ($REV) wordt gedeployed." >&2
fi
echo "Deploy $REV naar $HOST:$STACK"
ssh "$HOST" "mkdir -p $STACK/data && rm -rf $STACK/app.new && mkdir -p $STACK/app.new"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C $STACK/app.new"
ssh "$HOST" "set -e
	cd $STACK
	rm -rf app.prev && { [ -d app ] && mv app app.prev || true; } && mv app.new app
	cp app/deploy/compose.yaml compose.yaml
	echo $REV > app/REVISION
	if [ ! -f .env ]; then
		umask 077
		printf 'SERVER_KEY=%s\nSIGNUP_CODE=%s\nTMDB_API_KEY=\n' \"\$(openssl rand -base64 32)\" \"\$(openssl rand -hex 6)\" > .env
		echo 'Nieuwe .env aangemaakt met SERVER_KEY en SIGNUP_CODE (bewaar een backup!).'
	fi
	docker compose build --pull $SERVICES
	docker compose up -d --no-deps $SERVICES
	docker image prune -f >/dev/null
	docker compose ps"
