const Discord = require("discord.js");
const BOT_TOKEN = "ODAyOTQ3NzMwMzM4MDg2OTMy.YA2pWA.sfIzE64sq6sa0usdSNptFXih8hs";
const prefix = "!";

const client = new Discord.Client();
client.on("message", async (msg)=>{
    console.log(msg.content)
    if (msg.author.bot) return;
    if (!msg.content.startsWith(prefix)) return;

    const args = msg.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    if (command === "ping") {
        msg.reply('Pong!');
    } else if (command === "avatar") {
        msg.reply(msg.author.displayAvatarURL());
    } else if (command === "arse") {
        msg.channel.send({
            files: ["https://i.imgur.com/wSTFkRM.png"]
        });
    }
});

client.on('ready', () => {
    console.log("Discord Bot logged in...");
    client.channels.cache;
});

console.log("Discord Bot Running...");

client.login(BOT_TOKEN);