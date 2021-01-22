const process = require("process");
const path = require('path');
const NodeMediaServer = require('node-media-server');
const child_process = require('child_process');

const NMS_APP_NAME = "live";
const NMS_RTMP_PORT = 1935;
const NMS_HTTP_PORT = 8115;
const NMS_AUTH_USERNAME = "nms";
const NMS_AUTH_PASSWORD = "nms";

const APP_DIR = path.resolve(path.join(__filename, ".."));

const FFMPEG_PATH = `C:/Dev/ffmpeg-4.2.3-win64-static/bin/ffmpeg.exe`;

// example command to stream to server:
// ffmpeg -re -f lavfi -i life -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -preset ultrafast -c:v libx264 -tune zerolatency -c:a aac -f flv rtmp://127.0.0.1:1935/1

process.chdir(APP_DIR);

// webrtc = child_process.spawn("go", ["run", "*.go"], cwd=path.join(APP_DIR, "rtmp-to-webrtc"))

const nms = new NodeMediaServer({
    rtmp: {
        port: NMS_RTMP_PORT,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: NMS_HTTP_PORT,
        mediaroot: './media',
        allow_origin: '*'
    },
    auth: {
        api : true,
        api_user: NMS_AUTH_USERNAME,
        api_pass: NMS_AUTH_PASSWORD
    },
    /* trans: {
      ffmpeg: FFMPEG_PATH,
      tasks: [
        {
          app: "live",
          hls: true,
          hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        }
      ]
    }, */
    /* relay: {
        ffmpeg: `C:\Dev\ffmpeg-4.2.3-win64-static\bin\ffmpeg.exe`,
        tasks: [
            {
                app: 'restream',
                mode: 'push',
                edge: 'rtmp://live.twitch.tv/app/live_612263494_FsnYGIqJe4KuxUvmwqLqqFQHBd78QD',
                appendName: false,
            }
        ]
    } */
});

function run() {
    nms.run();

    if (nms.nrs) {
        nms.nrs.tcpServer.on('error', (e) => {
            console.error(e, "nms");
            if (e.code === "EADDRINUSE") {
                process.exit();
            }
        });
    }

    nms.on('preConnect', (id, args) => {
        console.log(`[NodeEvent on preConnect] id=${id} args=${JSON.stringify(args)}`);
    });

    nms.on('postConnect', (id, args) => {
        console.log(`[NodeEvent on postConnect] id=${id} args=${JSON.stringify(args)}`);
    });

    nms.on('doneConnect', (id, args) => {
        console.log(`[NodeEvent on doneConnect] id=${id} args=${JSON.stringify(args)}`);
    });

    nms.on('prePlay', (id, StreamPath, args) => {
        console.log(`[NodeEvent on prePlay] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
        var session = nms.getSession(id);
        // if (args.app !== NMS_APP_NAME) session.reject();
    });

    nms.on('postPlay', (id, StreamPath, args) => {
        console.log(`[NodeEvent on postPlay] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    });

    nms.on('donePlay', (id, StreamPath, args) => {
        console.log(`[NodeEvent on donePlay] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    });

    nms.on('prePublish', (id, StreamPath, args) => {
        console.log(`[NodeEvent on prePublish] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
        var session = nms.getSession(id);
        var app_name = StreamPath.split("/")[1];
        if (app_name !== NMS_APP_NAME) session.reject();
    });

    nms.on('postPublish', async (id, StreamPath, args) => {
        console.log(`[NodeEvent on postPublish] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    });

    nms.on('donePublish', (id, StreamPath, args) => {
        console.log(`[NodeEvent on donePublish] id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    });
}

if (require.main === module) {
    run();
}

module.exports = { NMS_AUTH_USERNAME, NMS_AUTH_PASSWORD, NMS_APP_NAME, NMS_RTMP_PORT, NMS_HTTP_PORT, APP_DIR, FFMPEG_PATH, nms };