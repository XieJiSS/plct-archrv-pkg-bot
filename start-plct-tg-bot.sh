# You may change to use pm2
cd "$(dirname "$0")"
nohup yarn tsx ./src/plct-archrv-bot.ts --verb 1>>./log.log 2>&1 &
