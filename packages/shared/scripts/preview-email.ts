import { writeFileSync } from "node:fs";
import { renderScanComplete } from "../src/notifications/email";

const tpl = await renderScanComplete({
  handle: "yatendra2001",
  profileUrl: "https://gitshow.io/u/yatendra2001",
});

writeFileSync("/tmp/gitshow-email-preview/scan-complete.html", tpl.html);
writeFileSync("/tmp/gitshow-email-preview/scan-complete.txt", tpl.text);

console.log("subject:", tpl.subject);
console.log("html  :", tpl.html.length, "bytes → /tmp/gitshow-email-preview/scan-complete.html");
console.log("text  :", tpl.text.length, "bytes → /tmp/gitshow-email-preview/scan-complete.txt");
