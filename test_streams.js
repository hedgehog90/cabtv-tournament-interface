const process = require("process");
const path = require('path');
const child_process = require('child_process');

for (var i = 0; i<6; i++) {
    child_process.spawn("ffmpeg", ["-re", "-stream_loop", "-1", "-i", `test/${i}.mp4`, "-preset", "ultrafast", "-c:v", "libx264", "-b:v", "2500k", "-tune", "zerolatency", "-c:a", "aac", "-b:a", "160k", "-vf", `drawtext=text='%{e\\:t}':fontsize=40:fontcolor=white:x=10:y=10`, "-flags", "+global_header", "-f", "tee", "-map", "0:v", "-map", "0:a", `[f=flv]rtmp://localhost:1935/live/${i}`]);
}