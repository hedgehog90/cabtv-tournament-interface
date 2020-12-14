FOR /L %%i IN (1,1,4) DO (
	start cmd /k ffmpeg -re -stream_loop -1 -i "test/%%i.mp4" -preset ultrafast -c:v libx264 -b:v 5000k -tune zerolatency -c:a aac -b:a 160k -f flv rtmp://localhost:1935/live/%%i
)