@echo off
setlocal enabledelayedexpansion
SET "OUTPUT="
FOR /L %%i IN (1,1,6) DO (
	IF [!OUTPUT!]==[] (
		SET "OUTPUT=[f=flv]rtmp://localhost:1935/live/%%i"
	) ELSE (
		SET "OUTPUT=!OUTPUT!^|[f=flv]rtmp://localhost:1935/live/%%i"
	)
)
ffmpeg -re -stream_loop -1 -i "test\test.mkv" -preset ultrafast -c:v libx264 -b:v 2500k -tune zerolatency -c:a aac -b:a 160k -vf drawtext=text='%%{e\:t}':fontsize=40:fontcolor=white:x=10:y=10 -flags +global_header -f tee -map 0:v -map 0:a "!OUTPUT!"
:: call ffmpeg -re -stream_loop -1 -i "test\test.mkv" -preset ultrafast -c:v libx264 -b:v 2500k -tune zerolatency -c:a aac -b:a 160k -vf "drawtext=text='%{e\:t}':fontsize=40:fontcolor=white:x=10:y=10" -flags +global_header -f tee -map 0:v -map 0:a "!OUTPUT!"