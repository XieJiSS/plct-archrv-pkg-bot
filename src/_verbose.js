const obj2table = require("./_obj2table");

const ENABLED = !process.argv.includes("--verb=0");

function verbose() {
  const args = [...arguments];
  const timeStr = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  }) + " (+8):";
  if(ENABLED) {
    if(args.length === 1 && typeof args[0] === "object") {
      console.log("[VERB]", timeStr);
      const lines = obj2table(args[0]).split("\n");
      console.log(lines.map(line => ["[VERB]", line].join(" ")).join("\n"));
      return;
    }
    if(args.length === 2 && typeof args[0] === "string" && typeof args[1] === "object") {
      console.log("[VERB]", timeStr, args[0]);
      const lines = obj2table(args[1]).split("\n");
      console.log(lines.map(line => ["[VERB]", line].join(" ")).join("\n"));
      return;
    }
    console.log.apply(null, ["[VERB]", timeStr].concat(args.map(f => {
      if(typeof f === "function") {
        return f.name + (f.length ? "(...)" : "()");
      }
      return f;
    })));
  }
}

module.exports = verbose;
