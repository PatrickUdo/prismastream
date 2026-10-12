#!/usr/bin/env bash
# Builds the PrismaStream images locally (linux/amd64) from the committed HEAD, ships them to the VPS
# and restarts the stack. The VPS has no swap and ~1 GB free RAM, so nothing is built there.
# Usage: [SERVICES="web backend"] deploy/deploy.sh [ssh-host]   (default root@vps.prisma-scripts.com)
set -euo pipefail
HOST="${1:-root@vps.prisma-scripts.com}"
STACK=/opt/stacks/prismastream
SERVICES="${SERVICES:-web backend}"
BACKEND_URL=https://backend.prismastream.patrickudo.nl
REV=$(git rev-parse --short HEAD)
ROOT=$(git rev-parse --show-toplevel)
if [ -n "$(git status --porcelain)" ]; then
	echo "Let op: niet-gecommitte wijzigingen worden NIET meegenomen; alleen HEAD ($REV)." >&2
fi

# Build from a clean export of HEAD so local, uncommitted files never end up in an image.
CTX=$(mktemp -d)
trap 'rm -rf "$CTX"' EXIT
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$CTX"
echo "$REV" > "$CTX/REVISION"

IMAGES=()
for svc in $SERVICES; do
	case $svc in
	web)
		docker build --platform linux/amd64 -f "$CTX/deploy/web.Dockerfile" \
			--build-arg VITE_BACKEND_URL=$BACKEND_URL --build-arg VITE_DEMO=false -t prismastream-web:latest -t prismastream-web:$REV "$CTX"
		IMAGES+=(prismastream-web:latest prismastream-web:$REV) ;;
	backend)
		docker build --platform linux/amd64 -f "$CTX/server/Dockerfile" \
			-t prismastream-backend:latest -t prismastream-backend:$REV "$CTX"
		IMAGES+=(prismastream-backend:latest prismastream-backend:$REV) ;;
	*) echo "Onbekende service: $svc" >&2; exit 1 ;;
	esac
done

echo "Images naar $HOST sturen…"
docker save "${IMAGES[@]}" | gzip -1 | ssh "$HOST" 'gunzip | docker load'

ssh "$HOST" "mkdir -p $STACK/data && chown -R 1000:1000 $STACK/data && chmod 700 $STACK/data"
scp -q "$CTX/deploy/compose.yaml" "$HOST:$STACK/compose.yaml"
ssh "$HOST" "set -e
	cd $STACK
	if [ ! -f .env ]; then
		umask 077
		printf 'SERVER_KEY=%s\nSIGNUP_CODE=%s\nTMDB_API_KEY=\n' \"\$(openssl rand -base64 32)\" \"\$(openssl rand -hex 6)\" > .env
		echo 'Nieuwe .env aangemaakt met SERVER_KEY en SIGNUP_CODE (maak een backup van deze sleutel!).'
	fi
	echo $REV > REVISION
	docker compose up -d --no-deps $SERVICES
	docker image prune -f >/dev/null
	docker compose ps"
echo "Klaar: $REV"
