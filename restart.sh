cd "$(dirname "$0")"

cat log.log | grep PID | tail -n 1 | cut -d " " -f 3 | xargs kill

./start-plct-tg-bot.sh
