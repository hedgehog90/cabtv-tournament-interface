const electron = require('electron');
const _ = require('lodash');
const $ = jQuery = require('jquery');
const flvjs = require("flv.js");
const fs = require("fs");
const events = require("events");
const path = require("path");
const Sortable = require("sortablejs");
const Color = require("color");
const {table} = require('table')
const Chart = require('chart.js')
const Discord = require("discord.js");
const humanize_duration = require('humanize-duration')
const mathjs = require("mathjs");
const copy_to_clipboard = require('copy-text-to-clipboard');
// const html_to_image = require("html-to-image");
const utils = require("../utils");
const server = require("../server");
const discord_config = require("../private/discord-config.json");

const AUTOSAVE_DIR = path.join(electron.remote.getGlobal('USER_DATA_PATH'), "autosaves");
const WORKLET_PROCESSORS_JS = "worklet-processors.js";
const OFFLINE_TIMER = 5000;
const AUTOSAVE_INTERVAL = 10*1000;
const MAX_AUTOSAVE_FILES = 128;
const AVG_LATENCY_BUFFER_SIZE = 32;
const LATENCY_ALLOWED_MISALIGNMENT = 100;
const MIN_PLAYBACK_RATE = 0.5;
const MAX_PLAYBACK_RATE = 2;
const SPEED_DIFF_MAX_TIME = 1000;
const TICK_RATE = 1000/30;
const MAX_CHART_DATA = 60;
const SORTABLE_DEFAULT_OPTIONS = {
    filter: "input, textarea, button",
    preventOnFilter: false
}

const ChallengeStatus = {
    inactive: [0, "Inactive / Reset"],
    active_pending: [1, "Active (pending)"],
    active_starting: [2, "Active (starting)"],
    active: [3, "Active"],
    active_finishing: [4, "Active (finishing)"],
    active_finished: [5, "Active (finished)"],
    archived: [6, "Archived"],
    // static pending = 1;
}

const discord_client = new Discord.Client();
var discord_client_promise = new Promise((resolve)=>{
    discord_client.on('ready', () => {
        console.log("Discord Bot logged in...");
        resolve();
    });
})

discord_client.on("message", async (msg)=>{
    if (msg.author.bot) return;
    if (!msg.content.startsWith(prefix)) return;

    const args = msg.content.slice(prefix.length).trim().split(/\s+/g);
    const command = args.shift().toLowerCase();

    if (command === "scores") {
        
    }
});

discord_client.login(discord_config.bot_token);

const stage = document.getElementById("stage");
const header = document.getElementById("header");
const header_title = $(header).find(".title")[0];
const header_players_wrapper = $(header).find(".players-wrapper")[0];
const header_scores = $(header).find("#scores")[0];
const header_positions = $(header).find("#positions")[0];
const header_wrapper = header.parentElement;
const round_timer = document.getElementById("round-timer");
const round_name = document.getElementById("round-name");
const footer = document.getElementById("footer");
const footer_game = $(footer).find(".game")[0];
const footer_info = $(footer).find(".info")[0];
const footer_wrapper = footer.parentElement;
const stage_wrapper = stage.parentElement;
const screens_container = document.getElementById("screens-container");

const STREAMS = new Set();
const CHALLENGES = new Set();
const CONTROL_PANELS = new Set();
const SCREENS = new Set();
var round = null;

var props = 0;
var server_streams = {};
var last_tick = +new Date();
var stage_volume = 1.0;

// ---------------------------------

function readdir_sorted_by_mtime(dir) {
    return fs.readdirSync(dir).map((p)=>({p:p,mtime:fs.statSync(path.join(dir,p)).mtime.getTime()})).sort((a,b)=>a.mtime-b.mtime).map(o=>o.p);
}
function autosave() {
    localStorage.setItem("autosave", JSON.stringify(get_save_data()));
    var files = readdir_sorted_by_mtime(AUTOSAVE_DIR);
    while (files.length > MAX_AUTOSAVE_FILES) {
        fs.unlinkSync(path.join(AUTOSAVE_DIR, files[0]));
        files.shift();
    }
    var filepath = path.join(AUTOSAVE_DIR, `${+new Date()}.json`);
    save_to(filepath);
}
function autoload() {
    var save_data
    try {
        save_data = JSON.parse(localStorage.getItem("autosave"));
    } catch {}
    load_save_data(save_data);
}

function get_save_data() {
    return {
        settings: settings.get_data(),
        streams: Stream.get_streams().map(s=>s.get_data()),
        challenges: Challenge.get_challenges().map(c=>c.get_data())
    }
}

function load_save_data(data) {
    settings.properties.set_properties(data.settings);

    for (var s of Array.from(STREAMS)) s.destroy();
    for (var c of Array.from(CHALLENGES)) c.destroy();

    for (var s of data.streams) new Stream(s.id).set_data(s)
    for (var c of data.challenges) new Challenge().set_data(c)
}

function save_to(file_path) {
    var data_str = JSON.stringify(get_save_data(), null, "  ");
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, data_str);
}

function load_from(file_path){
    var data_str = fs.readFileSync(file_path, "utf8");
    var data = JSON.parse(data_str)
    load_save_data(data);
}

async function load_dialog(){
    var result = await electron.remote.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'JSON', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (result.filePaths.length > 0) load_from(result.filePaths[0]);
}

async function save_dialog(){
    var result = await electron.remote.dialog.showSaveDialog({
        defaultPath: 'SaveData.json',
    });
    if (result.filePath) save_to(result.filePath)
}

function calc_volume(x) {
    var a = 0.7;
    var b = 0.6;
    return utils.clamp(Math.pow(b,x-1)*a+(1-a),0,1);
}

function format_positional(i) {
    var suffix = "th";
    if (i % 10 == 1) suffix = "st";
    else if (i % 10 == 2) suffix = "nd";
    else if (i % 10 == 3) suffix = "rd";
    return `${i}${suffix}`;
}

function calculate_scoring(num_players) {
    var scores = [];
    for (var i = num_players-1; i >= 0; i--) {
        scores.push(i+1);
    }
    // scores[0]++;
    return scores;
}

function calculate_positions(items, score_callback) {
    items = Array.from(items);
    utils.sort(items, (e)=>[score_callback(e), "DESCENDING"]); // ensure items are sorted, but won't change anything if in order.
    var last_pos = 0;
    var last_score;
    var map = new Map();
    items.forEach((item,i)=>{
        var s = score_callback(item)
        last_pos = (s==last_score) ? last_pos : i;
        last_score = s;
        map.set(item, last_pos);
    });
    return map;
}

function format_score(score) {
    return `${score} pts`;
}

function format_score_breakdown(scores, show_total=false) {
    var parts = [];
    var total = 0;
    if (scores.length === 1) {
        return format_score(scores[0]);
    }
    for (var i = 0; i < scores.length; i++) {
        var s = scores[i];
        total += s;
        if (i === 0) parts.push(format_score(s));
        else parts.push(s<0?"-":"+", format_score(Math.abs(s)));
    }
    if (show_total) parts.unshift(`(${format_score(total)})`)
    return parts.join(" ");
}

function nl2br(str, replace='<br>') {
    return str.replace(/(?:\r\n|\r|\n)/g, replace);
}

function move_to(value, target, delta) {
    delta = Math.abs(delta);
    if (Math.abs(target - value) <= delta) value = target;
    else if (value > target) value -= delta
    else value += delta;
    return value;
}

function scrollIntoView (e) {
    e.scrollIntoView({behaviour:"smooth", block:"center", inline:"center"});
}
var last_scroll = null;
function copy_scroll (e) {
    last_scroll = [e.scrollTop, e.scrollLeft];
    return last_scroll;
}
function paste_scroll (e, value) {
    if (!value) value = last_scroll;
    if (value) {
        e.scrollTop = value[0];
        e.scrollLeft = value[1];
    }
}

function make_2d_array_rows_same_length(arr) {
    var max_cols = Math.max(...arr.map(a=>a.length));
    arr.forEach(a=>a.length = max_cols);
}

function table_with_header(header, table_arr) {
    var lines = table(table_arr).split("\n");
    var width = lines[0].length;
    var pleft = Math.max(1, Math.floor((width - header.length-2)/2));
    var pright = Math.max(1, Math.ceil((width - header.length-2)/2));
    var padded_header = " ".repeat(pleft) + header + " ".repeat(pright);
    // if (padded_header.length > width) {
    for (var i = 0; i < lines.length; i++) {
        var a = lines[i].substr(0, width-2);
        var b = lines[i].substr(width-2, 1);
        var c = lines[i].substr(width-1, 1);
        lines[i] = a + b.repeat(padded_header.length - width + 3) + c;
    }
    width = lines[0].length
    // }
    var top = `╔${"═".repeat(width-2)}╗`;
    var tos = `║${padded_header}║`;
    var tob = `╠${lines[0].substring(1,width-1)}╣`;

    return [top, tos, tob, ...lines.slice(1)].join("\n");
}

function get_chart_js_line_options(length, value_cb) {
    return {
        type: 'line',
        data: {
            labels: new Array(length),
            datasets: [{
                data: new Array(length).fill(0),
                lineTension: 0,
                pointRadius: 0,
                borderWidth: 1,
            }]
        },
        options: {
            animation: false,
            events: [],
            legend: {
                display: false
            },
            tooltips: {
                enabled: false
            },
            maintainAspectRatio: false,
            responsive:false, 
            scales: {
                yAxes: [{
                    ticks: {
                        callback: value_cb,
                        maxTicksLimit: 1,
                    }
                }],
                xAxes: [{
                    display: false
                }]
            }
        }
    }
}

function add_data_chart(chart, label, data, limit=0) {
    chart.data.labels.push(label);
    chart.data.datasets.forEach((dataset)=>dataset.data.push(data));
    if (limit) {
        chart.data.labels.splice(0,chart.data.labels.length-limit);
        chart.data.datasets.forEach((dataset)=>dataset.data.splice(0,dataset.data.length-limit));
    }
    chart.update();
}

function pop_data_chart(chart) {
    chart.data.labels.pop();
    chart.data.datasets.forEach((dataset)=>dataset.data.pop());
    chart.update();
}

function get_random_color() {
    return "#" + Math.floor(Math.random()*16777215).toString(16);
}

function code_markdown(str) {
    return "```\n"+str.trim()+"\n```";
}
async function send_to_discord(msg) {
    await discord_client_promise;
    discord_client.channels.cache.get(discord_config.channel_id).send(msg);
}

async function format_discord_big(msg) {
    var chars = msg.toLowerCase().replace(/\s+/gi, " ").split();
    return chars.map(c=>{
        if (c.match(/[a-z]/)) return `:regional_indicator_${c}:`
        return c;
    }).join("  ");
}

function resize_chart(chart, width, height) {
    var update = false;
    if (width != null && width != chart.canvas.width) {
        chart.canvas.width = chart.width = width;
        update = true;
    }
    if (height != null && height != chart.canvas.height) {
        chart.canvas.height = chart.height = height;
        update = true;
    }
    if (update) {
        chart.stop();
        chart.update({duration:0});
    }
}

function set_element_index(e, i) {
    copy_scroll(e);
    var index = $(e).index();
    if (i < 0) i = 0;
    if (i >= e.parentElement.childElementCount) i = e.parentElement.childElementCount-1;
    if (index == i) return;
    if (i == e.parentElement.childElementCount-1) e.parentElement.append(e);
    else {
        if (index < i) i++;
        e.parentElement.insertBefore(e, e.parentElement.childNodes[i]);
    }
    paste_scroll(e);
}

function set_text(elem, text) {
    text = String(text);
    if (elem.textContent != text) elem.textContent = text;
}

function set_inner_html(elem, html) {
    if (elem.innerHTML != html) elem.innerHTML = html;
}

function toggle_class(elem, clazz, value) {
    if (elem.classList.contains(clazz) != value) {
        elem.classList.toggle(clazz, value);
    }
}

function set_attribute(elem, attr, value) {
    if (elem.getAttribute(attr) != value) {
        elem.setAttribute(attr, value);
    }
}

function toggle_attribute(elem, attr, value) {
    if (elem.hasAttribute(attr) != value) {
        elem.toggleAttribute(attr, value);
    }
}

function set_style_property(elem, prop, value) {
    if (elem.style.getPropertyValue(prop) != value) {
        elem.style.setProperty(prop, value);
    }
}

// -------------------------------------------------------

function create_button(id, label, onclick = null) {
    var element = $(`<button class="ui ui-button">${label}</button>`)[0];
    if (id) element.setAttribute("id", id);
    element.onclick = onclick;
    return element;
}

function create_label(label) {
    return $(`<label>${label}</label>`)[0];
}
function create_box() {
    return $(`<div class="ui ui-box"></div>`)[0];
}

function create_time_input(value=null) {
    var input = $(`<input type="text">`)[0];
    var modifier = (v)=>utils.time_str_to_ms(v, "hh:mm:ss");
    var renderer = (v)=>utils.time_to_str(v, "hh:mm:ss");
    var orig_val_prop = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    Object.defineProperty(input, 'value', {
        get() {
            return modifier(orig_val_prop.get.apply(input));
        },
        set(value) {
            orig_val_prop.set.apply(input, [renderer(value)]);
        }
    });
    input.addEventListener("blur", (e)=>{
        orig_val_prop.set.apply(input, [renderer(input.value)]);
    });
    input.addEventListener("keydown", (e)=>{
        if (e.key == "Enter") input.blur();
    });
    input.value = value || 0;
    return input;
}

function create_range_and_number_input(value, min=null, max=null, step=1) {
    return ["range","number"].map(type=>`<input type="${type}" min="0" max="1" value="100" step="0.01">`).join("");
}

function create_property(id, label, html) {
    var element = $(`<div class="ui ui-property"></div>`)[0];
    if (id) element.setAttribute("id", id);
    var name = `prop_${props++}`;
    var inputs = $(html).toArray();
    var label_element;
    
    // input.setAttribute("name", id);
    for (let input of inputs) {
        if (input.type.toLowerCase()=="hidden") {
            element.style.display = "none";
        }
        input.setAttribute("id", name);
        input.addEventListener("input", (e)=>{
            inputs.filter(i=>i!=input).forEach(i=>i.value=input.value)
            element.dispatchEvent(new Event("input"));
        });
        input.addEventListener("change", (e)=>{
            inputs.filter(i=>i!=input).forEach(i=>i.value=input.value)
            element.dispatchEvent(new Event("change"));
            element.dispatchEvent(new Event("update"));
            // set_value(element.value, false);
        });
        element.append(input);
    }
    set_label(label);

    function set_label(label) {
        if (label_element) label_element.remove();
        if (label) {
            label_element = $(`<label>${label}</label>`)[0];
            // label_element.setAttribute("for", name);
            element.prepend(label_element);
        }
    }

    function set_value(value, trigger_change=true) {
        if (element.value == value) return;
        for (let input of inputs) {
            var node = input.nodeName.toLowerCase()
            var type = input.type.toLowerCase()
            if (node === "input" && type === "checkbox") {
                input.checked = value;
            } else {
                input.value = value;
            }
        }
        element.dispatchEvent(new Event("update"));
        if (trigger_change) element.dispatchEvent(new Event("change"));
    }

    function get_value() {
        var input = inputs[0];
        var node = input.nodeName.toLowerCase();
        var type = input.type.toLowerCase();
        var value = input.value;
        if (node === "input" && type === "checkbox") {
            value = input.checked;
        }
        if (node === "input" && ["number","range"].includes(type)) {
            try {
                value = JSON.parse(input.value);
            } catch {
                value = 0;
            }
        }
        return value;
    }

    element.input = inputs[0];
    element.inputs = inputs;
    element.set_label = set_label;
    element.get_value = get_value;
    element.set_value = set_value;
    element.add_option = function(value, label=null, selected=false){
        if (!label) label = value;
        var opt = $(`<option value="${value}">${label}</option>`)[0];
        if (selected) toggle_attribute(opt, "selected", true);
        inputs[0].append(opt);
    };
    element.remove_options = function(){
        while (inputs[0].length) inputs[0].remove(0);
    };
    element.get_options = function(){
        return $(inputs[0]).find(">option");
    };
    element.set_disabled = function(value) {
        for (let input of inputs) {
            toggle_attribute(input, value)
        }
    }

    Object.defineProperty(element, 'value', {
        get () {
            return get_value();
        },
        set (value) {
            set_value(value, false);
        }
    });
    
    return element;
}

function create_list(id, label) {
    var element = $(`<div class="ui ui-list"></div>`)[0];
    if (id) element.setAttribute("id", id);
    element.layout = create_layout();
    element.append(element.layout);
    element.get_properties = element.layout.get_properties;
    element.set_properties = element.layout.set_properties;
    var label_element;

    function set_label(label) {
        if (label_element) label_element.remove();
        if (label) {
            label_element = $(`<h3>${label}</h3>`)[0];
            element.prepend(label_element);
        }
    }
    element.set_label = set_label;
    set_label(label);
    return element;
}

function create_layout(id) {
    var element = $(`<div class="ui ui-layout"></div>`)[0];
    if (id) element.setAttribute("id", id);

    element.get_properties = function(){
        var properties = $(element).find(".ui-property[id]").toArray();
        var data = {};
        for (var p of properties) {
            data[p.getAttribute("id")] = p.value;
        }
        return data;
    };

    element.get_property = function(id) {
        return  $(element).find(`.ui-property#${id}`)[0];
    };

    element.set_properties = function(data, trigger=true) {
        for (var p in data) {
            var prop = element.get_property(p);
            if (!prop) {
                console.log(`'${p}' not found.`)
                continue;
            }
            /* if (typeof data[p] == "object") {
                prop.set_properties(data[p], trigger);
            } else {
                prop.set_value(data[p], trigger);
            } */
            prop.set_value(data[p], trigger);
        }
    };

    return element;
}

function create_move_buttons(target, horizontal=false) {
    var btn_group = create_layout();
    btn_group.classList.add("horizontal", "noscroll");
    var up = horizontal ? "left" : "up";
    var down = horizontal ? "right" : "down";
    var move_up_btn = create_button(null, `<i class="fas fa-angle-${up}"></i>`, ()=>{
        set_element_index(target, $(target).index()-1);
        scrollIntoView(target);
    });
    btn_group.append(move_up_btn);
    var move_down_btn = create_button(null, `<i class="fas fa-angle-${down}"></i>`, ()=>{
        set_element_index(target, $(target).index()+1);
        scrollIntoView(target);
    });
    btn_group.append(move_down_btn);
    var move_top_btn = create_button(null, `<i class="fas fa-angle-double-${up}"></i>`, ()=>{
        set_element_index(target, 0);
        scrollIntoView(target);
    });
    btn_group.append(move_top_btn);
    var move_bottom_btn = create_button(null, `<i class="fas fa-angle-double-${down}"></i>`, ()=>{
        set_element_index(target, target.parentElement.childElementCount-1);
        scrollIntoView();
    });
    btn_group.append(move_bottom_btn);
    return btn_group;
}

function create_timer_buttons(timer, label) {
    var button_group = create_layout();
    button_group.classList.add("horizontal", "noscroll");
    if (label) {
        button_group.append(create_label(label));
    }
    var reset_button = create_button(null, "Reset", ()=>timer.reset());
    button_group.append(reset_button);
    var pause_toggle_button = create_button(null, "Pause", ()=>{
        if (timer.paused) timer.resume();
        else timer.pause();
        pause_toggle_button.textContent = (timer.paused) ? "Resume" : "Pause"
    });
    button_group.append(pause_toggle_button);
    var reset_button = create_button(null, "Set To:", ()=>timer.restart(time.value));
    button_group.append(reset_button);
    var time = create_property(null, null, create_time_input());
    button_group.append(time);
    return button_group;
}

function play_sound(src, vol=1) {
    var audio = new Audio();
    audio.src = src;
    audio.volume = vol * settings.sfx_volume.value;
    audio.play();
}

function send_total_scores_to_discord() {
    var lines = [["#", "Name", "Score"]];
    Stream.calculate_positions().forEach((s)=>{
        lines.push([format_positional(s.position+1), s.name.value, format_score(s.score.value)]);
    });

    var embed = {
        color: 0x0099ff,
        title: `Round ${this.round_num} Results`,
        description: code_markdown(table(lines)),
    };

    send_to_discord({embed});
}

// -------------------------------------------------------

class ControlPanelWindow extends events.EventEmitter {
    element;
    layout;
    window;
    index;
    constructor(name, show_header=false) {
        super();
        this.name = name;
        this.index = CONTROL_PANELS.size;
        CONTROL_PANELS.add(this);
        this.element = this.layout = create_layout(null);
        if (show_header) {
            var header = $(`<h3>${name}</h3>`)[0];
            this.element.append(header);
        }
    }

    open() {
        this.window = window.open("./admin.html", this.name, `x=${this.index*480},y=${0},width=480,height=480`);
        this.window.onload = ()=>{
            this.window.document.body.append(this.element);
            this.window.onbeforeunload = (e)=>{
                setTimeout(()=>this.open(), 100);
                return true;
            };
        };
    }

    close() {
        if (this.window) {
            this.window.close()
            this.window = null;
        }
    }

    destroy() {
        if (this.window) this.window.onbeforeunload = null;
        this.removeAllListeners();
        this.close();
        CONTROL_PANELS.delete(this);
    }
}

class Streams extends ControlPanelWindow {
    constructor() {
        super("Streams");
        var list = create_list()
        set_style_property(list, "overflow", "auto");
        this.element.append(list);
        this.layout = list.layout
        this.layout.classList.add("horizontal");
        Sortable.create(this.layout, SORTABLE_DEFAULT_OPTIONS);
    }
}

class Challenges extends ControlPanelWindow {
    constructor() {
        super("Challenges");
        
        this.add_challenge_btn = create_button(null, `Add Challenge`, ()=>new Challenge());
        this.element.append(this.add_challenge_btn);

        this.layout = create_layout()
        this.element.append(this.layout);

        this.layout.classList.add("challenges", "horizontal");

        this.active_challenges = create_list("active", "Active");
        this.layout.append(this.active_challenges);
        Sortable.create(this.active_challenges.layout, SORTABLE_DEFAULT_OPTIONS);
        this.active_challenges.layout.classList.add("horizontal");

        this.inactive_challenges = create_list("inactive", "Inactive");
        this.layout.append(this.inactive_challenges);
        Sortable.create(this.inactive_challenges.layout, SORTABLE_DEFAULT_OPTIONS);
        this.inactive_challenges.layout.classList.add("horizontal");

        this.archived_challenges = create_list("archived", "Archived");
        this.layout.append(this.archived_challenges);
        Sortable.create(this.archived_challenges.layout, SORTABLE_DEFAULT_OPTIONS);
        this.archived_challenges.layout.classList.add("horizontal");

        this.toggle_archive_btn = create_button(null, "Show / Hide Archive", ()=>{
            $(this.archived_challenges.layout).toggleClass("display-none");
        });
        this.element.append(this.toggle_archive_btn);
    }
}

class Round extends ControlPanelWindow {
    timer = new Timer();
    results = new Set();
    challenge;
    round_num = 0;

    get num_players(){ return Stream.get_added_streams().length; }

    /* get results_text() {
        var embed = {
            color: 0x0099ff,
            title: `Round ${this.round_num} Results`,
            fields: [],
        }
        for (var r of this.get_results()) {
            var line = [];
            if (this.challenge.is_positional.value) {
                line.push(format_positional(r.calculate_position()));
            }
            line.push(r.stream.name.value, format_score(r.total_score));
            var breakdown = [];
            breakdown.push(r.main_score);
            for (var s of r.secondary_score_breakdown) {
                if (s) breakdown.push(s);
            }
            if (r.extra_score) {
                breakdown.push(r.extra_score);
            }
            if (breakdown.length > 1) {
                has_breakdown = true;
                line.push("("+format_score(breakdown)+")")
            }
            embed.fields.push({
                name: line[0],
                value: line.slice(1).join("\n"),
                inline: true,
            });
        }

        return {embed};
    } */
    
    constructor(challenge) {
        settings.round_num.value++;
        var round_num = settings.round_num.value
        super(`Round ${round_num}`);
        this.round_num = round_num;

        this.timer.on("second", (seconds_left)=>{
            if (seconds_left === 10*60) send_to_discord("10 minutes left...")
            else if (seconds_left === 5*60) send_to_discord("5 minutes left...")
            else if (seconds_left === 1*60) send_to_discord("1 minute left...")
            else if (seconds_left === 0) send_to_discord(format_discord_big("STOP"));
        })
        
        if (round) round.destroy();
        round = this;
        
        this.challenge = challenge;
        this.results_list = create_list("results", "Results");
        this.results_list.layout.classList.add("horizontal");
        Sortable.create(this.results_list.layout, SORTABLE_DEFAULT_OPTIONS);
        this.layout.append(this.results_list);

        this.refresh_players_button = create_button(null, "Refresh Players", ()=>this.init_results());
        this.results_list.append(this.refresh_players_button);
        // this.timer_prop = create_property(null, "Timer", create_time_input());
        // this.results_list.append(this.timer_prop);
        this.timer_btn_grp = create_timer_buttons(this.timer, "Timer");
        this.layout.append(this.timer_btn_grp);

        this.proceed_button = create_button(null, `Proceed`, ()=>this.challenge.status.value = this.challenge.next_status);
        this.layout.append(this.proceed_button);

        var btn_group = create_layout();
        btn_group.classList.add("horizontal", "noscroll");
        this.details_button = create_button(null, `Send Details to Discord`, ()=>this.send_details_to_discord());
        btn_group.append(this.details_button)
        this.results_button = create_button(null, `Send Results to Discord`, ()=>this.send_results_to_discord());
        btn_group.append(this.results_button)
        this.layout.append(btn_group)
        
        this.open();
        this.init_results();

        this.on_status_change = (value)=>{
            
            if (this.details_screen) this.details_screen.destroy();
            if (this.start_screen) this.start_screen.destroy();
            if (this.results_screen) this.results_screen.destroy();

            var time_limit = utils.time_str_to_ms(challenge.time_limit.value);
            var run_off_time = utils.time_str_to_ms(challenge.run_off_time.value);

            if (value == ChallengeStatus.inactive[0]) {
                this.timer.restart(0);
                this.destroy();
            } else if (value == ChallengeStatus.active_pending[0]) {
                this.timer.restart(settings.start_round_time.value);
                this.details_screen = new ChallengeDetailsScreen(this);
                this.send_details_to_discord();
            } else if (value == ChallengeStatus.active_starting[0]) {
                this.start_screen = new ChallengeStartScreen(this);
                this.timer.restart(0);
                this.start_screen.once("go", ()=>{
                    this.timer.restart(time_limit);
                });
            } else if (value == ChallengeStatus.active[0]) {
                // do nowt but wait
            } else if (value == ChallengeStatus.active_finishing[0]) {
                if (run_off_time > 0 && run_off_time < this.timer.time_left) {
                    this.timer.restart(run_off_time);
                }
            } else if (value == ChallengeStatus.active_finished[0]) {
                this.timer.restart(0);
                this.results_screen = new RoundResultsScreen(this);
                this.send_results_to_discord();
            } else if (value == ChallengeStatus.archived[0]) {
                this.timer.restart(0);
                this.apply_scores();
                this.destroy();
            }
        };

        challenge.on("status_change", this.on_status_change);
    }

    calculate_positions(results) {
        var map;
        results.forEach(r=>r._position=-1);
        if (this.challenge.is_positional.value) {
            var last_position = 0;
            map = new Map();
            results.forEach((r,i)=>{
                last_position = r.position_joint_above.value ? last_position : i;
                map.set(r,last_position);
            })
        } else {
            map = calculate_positions(results, r=>r.total_score);
        }
        results.forEach(r=>r._position=map.get(r));
    }

    send_details_to_discord() {
        var embed = {
            color: 0x0099ff,
            title: `Round ${this.round_num} Details`,
            fields: [
                {
                    name: 'Game',
                    value: this.challenge.game.value || "N/A",
                },
                {
                    name: 'Description',
                    value: this.challenge.description.value || "N/A",
                },
            ],
            footer: {
                text: `Round ${this.round_num} will begin in around ${humanize_duration(settings.start_round_time.value)}`+"\n"+
                `You may load the game but not proceed past the title screen until I say GO`
            }
        };
        
        if (this.challenge.is_positional.value) {
            var parts = calculate_scoring(this.num_players).map((e,i)=>`${format_positional(i+1)} = ${format_score(e)}`);
            embed.fields.push({
                name: 'Scoring',
                value: parts.join(", "),
            });
        }
        
        var secondaries = this.challenge.get_secondaries()
        if (secondaries.length > 0) {
            var pos = 0;
            var neg = 0;
            for (var s of secondaries) {
                var label = s.score.value > 0 ? `Secondary` : `Penalty`;
                var num = s.score.value > 0 ? ++pos : ++neg;
                embed.fields.push({
                    name: `${label} ${num}`,
                    value: s.descriptive_text
                });
            }
        }
        
        if (this.challenge.time_limit.value) {
            embed.fields.push({
                name: `Time limit`,
                value: humanize_duration(this.challenge.time_limit.value)
            });
        }
        if (this.challenge.run_off_time.value) {
            embed.fields.push({
                name: `Run-off Time`,
                value: humanize_duration(this.challenge.run_off_time.value)
            });
        }
        send_to_discord({embed});
    }
    
    send_results_to_discord() {
        var keys = {
            position: "#",
            name: "Name",
            score: "Score",
        }
        
        var rows = [];
        rows.push(Object.values(keys));
        var results = this.get_results();
        this.calculate_positions(results);
        results = results.map(r=>{
            var position = format_positional(r.position+1);
            var name = r.stream.name.value;
            var score = format_score_breakdown(r.score_breakdown, true);
            return {
                position,
                name,
                score,
            };
        });
        for (var r of results) {
            rows.push(Object.keys(keys).map(k=>r[k]));
        }
        var embed = {
            color: 0x0099ff,
            title: `Round ${this.round_num} Results`,
            description: code_markdown(table(rows)),
        }
        send_to_discord({embed});
    }

    get_result_from_stream(stream) {
        return Array.from(this.results).filter(s=>s.stream===stream)[0] || null;
    }

    get_result_from_element(element) {
        return Array.from(this.results).filter(s=>s.layout===element)[0] || null;
    }

    get_results() {
        var results = Array.from(this.results);
        if (this.challenge.is_positional.value) {
            results.sort((a,b)=>a.index-b.index);
        } else {
            results.sort(a,b=>b.total_score-a.total_score);
        }
        return results;
    }

    apply_scores() {
        for (var r of this.get_results()) {
            r.stream.score.value += r.total_score;
        }
        send_total_scores_to_discord();
    }

    init_results() {
        var remaining = new Set(this.results);
        for (var stream of Stream.get_added_streams()) {
            var result = this.get_result_from_stream(stream) || new RoundResult(this, stream);
            remaining.delete(result);
        }
        for (var c of remaining) c.destroy();
    }

    update() {
        for (var r of this.results) r.update();
        this.proceed_button.textContent = this.challenge.proceed_button.textContent;
        // if (this.timer.time_left < 60*1000)
    }

    destroy() {
        super.destroy();
        this.timer.pause();
        round = null;
        if (this.details_screen) this.details_screen.destroy();
        if (this.start_screen) this.start_screen.destroy();
        if (this.results_screen) this.results_screen.destroy();
        this.challenge.off("status_change", this.on_status_change);
    }
}

class Settings extends ControlPanelWindow {

    get aspect_ratio(){
        var ar = +this.default_aspect_ratio.value
        if (ar) return ar;
        try {
            return +eval(this.custom_aspect_ratio.value.replace(":","/")) || 4/3;
        } catch {
            return 4/3;
        }
    }
    
    voice_input_rms = 0;
    voice_input_audio_context = null;

    constructor() {
        super("Settings");
        
        this.properties = create_layout();
        this.target_latency = create_property("target_latency", `Target Latency (ms)`, `<input type="number" min="10" max="10000" step="10" value="1500">`);
        this.properties.append(this.target_latency);
        this.correct_latency = create_property("correct_latency", `Correct Latency`, `<input type="checkbox" checked>`);
        this.properties.append(this.correct_latency);

        this.api_refresh_interval = create_property("api_refresh_interval", `API Refresh Interval`, `<input type="number" min="0" max="10000" step="100" value="1000">`);
        this.properties.append(this.api_refresh_interval);

        this.auto_add_to_stage = create_property("auto_add_to_stage", `Auto Add to Stage`, `<input type="checkbox" checked>`);
        this.properties.append(this.auto_add_to_stage);

        this.always_one_stream_selected = create_property("always_one_stream_selected", `Always 1 Stream Selected`, `<input type="checkbox">`);
        this.properties.append(this.always_one_stream_selected);

        this.crop_video = create_property("crop_video", `Crop Video`, `<input type="checkbox" checked>`);
        this.properties.append(this.crop_video);

        this.default_aspect_ratio = create_property("default_aspect_ratio", `Default Aspect Ratio`, `<select></select>`);
        this.default_aspect_ratio.add_option(4/3, "4:3");
        this.default_aspect_ratio.add_option(16/9, "16:9");
        this.default_aspect_ratio.add_option(null, "Custom");
        this.properties.append(this.default_aspect_ratio);

        this.custom_aspect_ratio = create_property("custom_aspect_ratio", `Custom Aspect Ratio (Width:Height)`, `<input type="text" value="4:3">`);
        this.properties.append(this.custom_aspect_ratio);

        this.select_volume_fade_time = create_property("select_volume_fade_time", `Select Volume Fade Time (ms)`, `<input type="number" value="500" step="100" min="0" max="5000">`);
        this.properties.append(this.select_volume_fade_time);

        this.start_round_time = create_property("start_round_time", `Start Round Time`, create_time_input(30*1000));
        this.properties.append(this.start_round_time);

        this.zoom_factor = create_property("zoom_factor", `Zoom Factor`, `<input type="number" value="1" step="0.05" min="0.5" max="10">`);
        this.properties.append(this.zoom_factor);

        this.adapt_to_window_size = create_property("adapt_to_window_size", `Adapt to Window Size`, `<input type="checkbox" checked>`);
        this.properties.append(this.adapt_to_window_size);

        this.stage_volume = create_property("stage_volume", "Global Stream Volume", create_range_and_number_input(1, 0, 1, 0.01));
        this.properties.append(this.stage_volume);
        
        this.stage_volume_screen = create_property("stage_volume_screen", "Volume % During Screen", create_range_and_number_input(0.25, 0, 1, 0.01));
        this.properties.append(this.stage_volume_screen);
        
        this.average_volume_multiple_selected = create_property("average_volume_multiple_selected", "Averagize volume multiple selected", `<input type="checkbox" checked>`);
        this.properties.append(this.average_volume_multiple_selected);
        
        this.sfx_volume = create_property("sfx_volume", "SFX Volume", create_range_and_number_input(0.8, 0, 1, 0.01));
        this.properties.append(this.sfx_volume);

        this.header_title_duration = create_property("header_title_duration", "Header Title Duration", create_time_input(5*1000));
        this.header_title_duration.addEventListener("change", ()=>update_header());
        this.properties.append(this.header_title_duration);

        this.header_scores_duration = create_property("header_scores_duration", `Header Score Duration`, create_time_input(30*1000));
        this.header_scores_duration.addEventListener("change", ()=>update_header());
        this.properties.append(this.header_scores_duration);

        this.header_positions_duration = create_property("header_positions_duration", `Header Position Duration`, create_time_input(5*1000));
        this.header_positions_duration.addEventListener("change", ()=>update_header());
        this.properties.append(this.header_positions_duration);

        this.footer_title_duration = create_property("footer_title_duration", "Footer Title Duration", create_time_input(5*1000));
        this.footer_title_duration.addEventListener("change", ()=>update_footer());
        this.properties.append(this.footer_title_duration);

        this.footer_info_speed = create_property("footer_info_speed", `Footer Info Speed (px/sec)`, `<input type="number" value="100" step="1" min="0">`);
        this.footer_info_speed.addEventListener("change", ()=>update_footer());
        this.properties.append(this.footer_info_speed);
        
        this.round_num = create_property("round", `Round #`, `<input type="number" value="0" step="1" min="0">`);
        this.properties.append(this.round_num);

        //--------

        // this.setup_device_selector("voice_input", `Voice Input`, "audioinput", (stream)=>this.init_voice_input(stream));

        // this._voice_input_rms = create_property("voice_input_rms", "Voice Input RMS", `<input type="range" min="0" max="100" value="100" step="0.1" disabled>`);
        // this.properties.append(this._voice_input_rms);

        // this.audio_output = this.setup_device_selector("audio_output", `Audio Output`, "audiooutput", (stream)=>this.init_output(stream));
        
        this.refresh_devices();
        setInterval(()=>this.refresh_devices(), 10000);

        //--------

        this.copy_scores_btn = create_button(null, "Send Total Scores to Discord", ()=>send_total_scores_to_discord());
        this.properties.append(this.copy_scores_btn);

        this.screen_opacity = create_property("screen_opacity", `Screen Opacity`, `<input type="range" value="1" step="0.01" min="0" max="1">`);
        this.properties.append(this.screen_opacity);

        this.screen_list = create_list("screens", "Screens");
        this.screen_list.classList.add("horizontal");

        this.properties.append(this.screen_list);
        this.clear_screens_btn = create_button(null, "Clear Screens", ()=>Screen.clear());
        this.screen_list.append(this.clear_screens_btn);

        var group = create_layout();
        group.classList.add("horizontal", "noscroll");
        this.load_button = create_button(null, "Load...", ()=>load_dialog());
        group.append(this.load_button);
        this.save_button = create_button(null, "Save...", ()=>save_dialog());
        group.append(this.save_button);
        this.properties.append(group);

        this.app_volume_prefs = create_button(null, "App volume device preferences", ()=>electron.shell.openPath("ms-settings:apps-volume"));
        this.properties.append(this.app_volume_prefs);

        this.layout.append(this.properties);
    }

    refresh_devices() {
        this.enumerating_devices_promise = navigator.mediaDevices.enumerateDevices();
        this.enumerating_devices_promise.then((devices)=>this.emit("updated_devices", devices))
    }

    setup_device_selector(id, label, kind, onchange) {
        var input = create_property(id, label, `<input type="hidden">`);
        this.properties.append(input);
        var select = create_property(`${id}_select`, label, `<select></select>`);
        this.properties.append(select);
        select.add_option("none", "None");
        this.on("updated_devices", async (devices)=>{
            devices = devices.filter(d=>d.kind===kind).map(d=>[d.deviceId, d.label])
            while (select.input.length > 1) select.input.remove(1);
            for (var d of devices) select.add_option(...d);
            // select.set_value(input.value, true);
            select.value = input.value;
        });
        select.onchange = ()=>{
            if (select.value === "") return;
            input.set_value(select.value, true);
        };
        input.onchange = async ()=>{
            var value = input.value;
            select.value = value;
            if (value == "none") {
                onchange(null);
            } else {
                onchange(value);
            }
        };
        return input;
    }

    init_output(device_id) {
        console.log(device_id);
    }

    /* async init_voice_input(device_id) {
        const constraints = {
            audio: {deviceId: device_id ? {exact: device_id} : undefined},
        };
        var stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (this.voice_input_audio_context) this.voice_input_audio_context.close();
        this.voice_input_audio_context = null;
        
        if (!stream) return;
        
        this.voice_input_audio_context = new AudioContext();
        var source = this.voice_input_audio_context.createMediaStreamSource(stream);
        this.voice_input_audio_context.audioWorklet.addModule(WORKLET_PROCESSORS_JS).then(()=>{
            console.log(stream)
            var processor = new AudioWorkletNode(this.voice_input_audio_context, 'get-rms-processor');
            processor.port.onmessage = (e)=>{
                var rms = utils.sum(e.data) / e.data.length;
                if (rms > this.voice_input_rms) this.voice_input_rms = rms;
                // console.log(rms)
                // if (rms > 0.2) {
                // }
            };
            source.connect(processor);
        }).catch(e=>console.error(e));
    } */

    update() {
        // this._voice_input_rms.value = this.voice_input_audio_context ? this.voice_input_rms * 100 : 0;
        // this.voice_input_rms -= 0.01;
    }

    get_data() {
        return this.properties.get_properties();
    }

    set_data(data) {
        this.properties.set_properties(data);
    }
}

// --------------------------------------------------

class Stream {
    video = null;
    flv_player = null;
    properties = null;
    offline = false;
    offline_time = 0;
    selected_time = 0;
    last_update_time = 0;
    latencies = [];

    #added_to_stage = false;
    #per_second_interval_id = null;
    #position = -1;
    get added_to_stage() { return this.#added_to_stage; }
    get index() { return $(this.properties).index(); }
    get id() { return this._id.value; }
    get data() { return server_streams[this.id] };
    get offline_persistant() { return this.offline && (+new Date() - this.offline_time) > OFFLINE_TIMER; };

    static fetch(id) {
        return Stream.get_stream(id) || new Stream(id);
    }

    static get_stream(id) {
        for (var s of STREAMS) {
            if (s.id == id) return s;
        }
        return null;
    }
    
    static get_streams() {
        return utils.sort(Array.from(STREAMS), s=>s.index, s=>s.name.value.toLowerCase());
    }
    
    static get_added_streams() {
        return Stream.get_streams().filter(s=>s.added.value);
    }
    
    static get_visible_streams() {
        return Stream.get_streams().filter(s=>!s.hidden.value && s.added.value);
    }
    
    static get_audible_streams() {
        return Stream.get_streams().filter(s=>s.added.value && s.selected.value && !s.mute.value);
    }

    static calculate_positions() {
        STREAMS.forEach(s=>s.#position=-1);
        var streams = Stream.get_added_streams();
        var positions_map = calculate_positions(streams, s=>s.score.value)
        streams.forEach((s)=>s.#position=positions_map.get(s));
        return streams;
    }

    constructor(id) {
        if (Stream.get_stream(id)) {
            throw new Error(`Stream [${id}] already exists.`);
        }
        this.properties = create_layout("stream");
        this.properties.classList.add("stream");

        this._id = create_property("id", `ID`, `<input type="hidden" value="${id}">`);
        this.properties.append(this._id);

        this.added = create_property("added", `Added`, `<input type="checkbox">`);
        this.properties.append(this.added);

        this.selected = create_property("selected", `Selected`, `<input type="checkbox">`);
        this.properties.append(this.selected);

        this.hidden = create_property("hidden", `Hidden`, `<input type="checkbox">`);
        this.properties.append(this.hidden);

        // this.focused = create_property("focused", `Focused`, `<input type="checkbox">`);
        // this.properties.append(this.focused);

        this.color = create_property("color", `Color`, `<input type="color" value="#ffffff">`);
        this.properties.append(this.color);

        this.name = create_property("name", `Name`, `<input type="text" value="${id}">`);
        this.properties.append(this.name);

        this.score = create_property("score", `Score`, `<input type="number" value="0">`);
        this.properties.append(this.score);

        var group = create_layout();
        group.classList.add("horizontal", "noscroll");
        group.append(create_label("Volume"));
        this.volume = create_property("volume", null, `<input type="range" min="0" max="1" value="1" step="0.01">`);
        group.append(this.volume);
        this.real_volume = create_property("real_volume", null, `<input type="range" min="0" max="1" value="1" step="0.001" disabled>`);
        group.append(this.real_volume);
        this.properties.append(group)

        this.mute = create_property("mute", `Mute`, `<input type="checkbox">`);
        this.properties.append(this.mute);

        this.init_video_button = create_button(null, `Init Video`, ()=>this.init_video());
        this.properties.append(this.init_video_button)

        this.scale = create_property("scale", "Scale", `<input type="number" min="10" max="500" value="100" step="0.1">`);
        this.properties.append(this.scale);

        var group = create_layout();
        group.classList.add("horizontal", "noscroll")
        group.append(create_label("Offset"));
        this.offset_x = create_property("offset_x", null, `<input type="number" step="0.1" value="0">`);
        group.append(this.offset_x);
        this.offset_y = create_property("offset_y", null, `<input type="number" step="0.1" value="0">`);
        group.append(this.offset_y);
        this.properties.append(group)

        this.move_buttons = create_move_buttons(this.properties, true);
        this.select_button = create_button(null, `<i class="fas fa-mouse-pointer"></i>`, ()=>this.select());
        this.move_buttons.append(this.select_button)
        this.destroy_button = create_button(null, `<i class="fas fa-trash-alt"></i>`, ()=>this.destroy());
        this.move_buttons.append(this.destroy_button)
        this.properties.append(this.move_buttons);
        
        var group = create_layout();
        group.classList.add("horizontal", "noscroll");
        group.append(create_label("Latency (ms)"));
        this.latency = create_property("latency", null, `<input type="number" disabled>`);
        group.append(this.latency);
        this.latency_slider = create_property("latency_slider", null, `<input type="range" min="0" max="5000" disabled>`);
        group.append(this.latency_slider);

        this.properties.append(group)

        this.latency_canvas = $(`<canvas width="300" height="60" style="width:100%"></canvas>`)[0];
        this.latency_chart = new Chart(this.latency_canvas.getContext('2d'), get_chart_js_line_options(MAX_CHART_DATA, (label)=>label+" ms"));
        this.properties.append(this.latency_canvas);

        this.playback_rate = create_property("playback_rate", "Playback Speed (%)", `<input type="number" step="0.01" disabled>`);
        this.properties.append(this.playback_rate);

        if (settings.auto_add_to_stage.value) {
            this.added.set_value(true);
        }
        
        var group = create_layout();
        group.classList.add("horizontal", "noscroll");
        group.append(create_label("Bit rate (Kbps)"));
        this.bitrate = create_property("bitrate", null, `<input type="text" disabled>`);
        group.append(this.bitrate)
        this.status_light = $(`<div class="ui status-box"></div>`)[0];
        group.append(this.status_light);
        this.properties.append(group)

        this.bitrate_canvas = $(`<canvas width="300" height="60" style="width:100%"></canvas>`)[0];
        this.bitrate_chart = new Chart(this.bitrate_canvas.getContext('2d'), get_chart_js_line_options(MAX_CHART_DATA, (label)=>Math.round(label/1024)+' Mbps'));
        this.properties.append(this.bitrate_canvas);

        this.toggle_stats = create_button(null, `Show/Hide Stats`, ()=>toggle_class(stream_data_elem, "display-none"));
        this.properties.append(this.toggle_stats)
        
        var stream_data_elem = create_box();
        stream_data_elem.classList.add("display-none");
        stream_data_elem.setAttribute("style","min-height:200px");
        this.stream_data_content = $(`<pre class=""></pre>`)[0];
        stream_data_elem.append(this.stream_data_content);
        this.properties.append(stream_data_elem);

        streams.layout.append(this.properties);

        // -------------------------------------

        this.stream_container = $(`<div class="stream-container" data-id="${id}"></div>`)[0];
        this.stream_element = $(`<div class="stream"></div>`)[0];
        this.stream_container.append(this.stream_element);
        this.video_wrapper = $(`<div class="video-wrapper"></div>`)[0];
        this.stream_element.append(this.video_wrapper)
        this.overlay_element = $(`<div class="overlay"></div>`)[0];
        this.offline_element = $(`<div class="offline">OFFLINE</div>`)[0];
        this.overlay_element.append(this.offline_element);
        this.info_element = $(`<span class="info"></span>`)[0];
        this.overlay_element.append(this.info_element);
        this.stream_element.append(this.overlay_element);

        this.loader = $(`<div class="loader"><div><div></div><div></div><div></div></div></div>`)[0];
        this.overlay_element.append(this.loader);

        this.video = document.createElement("video");
        // this.video.preservesPitch = false;
        this.video.muted = this.mute.value;
        this.video_wrapper.append(this.video);
        
        this.audio_context = new AudioContext();
        var source = this.audio_context.createMediaElementSource(this.video);

        var compressor = this.audio_context.createDynamicsCompressor();
        compressor.knee.value = 40;
        compressor.ratio.value = 40;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;
        source.connect(compressor);

        this.audio_context.audioWorklet.addModule(WORKLET_PROCESSORS_JS).then(() => {
            var dynamic_normalization = new AudioWorkletNode(this.audio_context, 'dynamic-normalization-processor');
            dynamic_normalization.parameters.get("wet").value = 0.75;
            dynamic_normalization.parameters.get("dry").value = 0.25;
            dynamic_normalization.parameters.get("volume").value = 0.0;
            this.volume_filter = dynamic_normalization;
            compressor.connect(dynamic_normalization).connect(this.audio_context.destination);
        });
        // compressor.connect(this.audio_context.destination);
        
        this.video.addEventListener('progress', ()=>{
        });

        this.stream_container.addEventListener("click", (e)=>{
            if (e.shiftKey) this.selected.value = !this.selected.value;
            else this.select();
        });

        this.header_element = $(`<div class="player"></div>`)[0];
        this.header_name_element = $(`<div class="name"></div>`)[0];
        this.header_score_element = $(`<div class="score"></div>`)[0];
        this.header_element.append(this.header_name_element);
        this.header_element.append(this.header_score_element);

        this.header_element2 = $(`<div class="player"></div>`)[0];
        this.header_name_element2 = $(`<div class="name"></div>`)[0];
        this.header_score_element2 = $(`<div class="position"></div>`)[0];
        this.header_element2.append(this.header_name_element2);
        this.header_element2.append(this.header_score_element2);
        
        STREAMS.add(this);

        this.#per_second_interval_id = setInterval(()=>this.#per_second(), 1000);
    }

    get is_buffering() {
        if (!this.video) return null;
        return this.video.readyState < this.video.HAVE_FUTURE_DATA;
    }

    get position() { return this.#position; }

    static from(data) {
        var s = Stream.fetch(data.id);
        s.properties.set_properties(data);
        return s;
    }

    #per_second() {
        add_data_chart(this.latency_chart, null, this.latency.value, MAX_CHART_DATA);
        add_data_chart(this.bitrate_chart, null, this.bitrate.value, MAX_CHART_DATA);
    }

    add_to_stage() {
        if (this.#added_to_stage) return;
        this.#added_to_stage = true;

        stage.append(this.stream_container);
        header_scores.append(this.header_element);
        header_positions.append(this.header_element2);

        this.init_video();
    }

    remove_from_stage() {
        if (!this.#added_to_stage) return;
        this.#added_to_stage = false;

        if (this.flv_player) {
            this.flv_player.destroy();
            this.flv_player = null;
        } else if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
        }

        this.stream_container.remove();
        this.header_element.remove();
        this.header_element2.remove();
    }

    async init_video() {
        console.log("init_video");
        utils.clear(this.latencies);

        if (this.flv_player) {
            await Promise.resolve(this.flv_init_promise);
            this.flv_player.pause();
            this.flv_player.unload();
            this.flv_player.detachMediaElement();
            this.flv_player.destroy();
            this.flv_player = null;
        }

        this.flv_player = flvjs.createPlayer({
            type: 'flv',
            url: `ws://localhost:${server.NMS_HTTP_PORT}/${server.NMS_APP_NAME}/${this.id}.flv`,
            isLive: true,
        },{
            enableStashBuffer: false,
            accurateSeek: true,
            // lazyLoad: false,
        });

        this.flv_player.attachMediaElement(this.video);
        this.flv_player.load();
        this.flv_init_promise = this.flv_player.play().then(()=>{
            // this.flv_player.currentTime = this.video.buffered.end(0) - 0.01;
        }).catch((e)=>console.log(e))
    }

    select() {
        for (var s of STREAMS) s.selected.value = false;
        this.selected.value = true;
        this.selected_time = +new Date();
    }

    update() {
        var now = +new Date();
        var delta = now - this.last_update_time;

        // if (Math.floor(now / 1000) != Math.floor(this.last_update_time / 1000)) {
            // resize_chart(this.latency_chart, this.latency_canvas.offsetWidth);
            // resize_chart(this.bitrate_chart, this.bitrate_canvas.offsetWidth);
        // }
        
        toggle_class(this.properties, "added", this.added.value);
        toggle_class(this.properties, "selected", this.selected.value);
        toggle_class(this.properties, "hidden", this.hidden.value);

        if (this.added.value) {
            this.add_to_stage();
            
            if (this.flv_player && this.flv_player.buffered.length > 0) {
                var end = this.flv_player.buffered.end(0) * 1000;
                var time = this.flv_player.currentTime * 1000;
                var latency = end - time;

                this.latencies.splice(0, this.latencies.push(latency)-AVG_LATENCY_BUFFER_SIZE);
                var avg_latency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;

                if (settings.correct_latency.value) {
                    var d = settings.target_latency.value - avg_latency;
                    var target_rate = 1;
                    if (Math.abs(d) > LATENCY_ALLOWED_MISALIGNMENT || this.fixing_latency) {
                        this.fixing_latency = true;
                        var x = utils.clamp(Math.abs(d) / SPEED_DIFF_MAX_TIME);
                        if (d > 0) target_rate = utils.lerp(1, MIN_PLAYBACK_RATE, x);
                        else target_rate = utils.lerp(1, MAX_PLAYBACK_RATE, x);
                        if (Math.abs(d) < 1) this.fixing_latency = false;
                        // target_rate = utils.range(-SPEED_DIFF_MAX_TIME, SPEED_DIFF_MAX_TIME, 1+MAX_SPEED_DIFF, 1-MAX_SPEED_DIFF, d);
                        // if (target_rate < 1) target_rate = (2 * target_rate) / 3 + (1/3);
                    }
                    this.video.playbackRate = target_rate;
                } else {
                    this.video.playbackRate = 1;
                }
                if (this.was_buffering && !this.is_buffering) {
                    this.was_buffering = false;
                    console.log(`STREAM [${this.id}] has finished buffering`)
                } else if (!this.was_buffering && this.is_buffering) {
                    this.was_buffering = true;
                    console.warn(`STREAM [${this.id}] is buffering...`)
                }
                var max_latency = Math.max(settings.target_latency.value * 2, 5000)
                if (latency > max_latency) {
                    // var utils.clamp(settings.target_latency.value + 200, 10, Number.POSITIVE_INFINITY)
                    this.flv_player.currentTime = (end - settings.target_latency.value) / 1000;
                }

                this.latency.value = Math.round(avg_latency);
                this.latency_slider.value = avg_latency;
                set_attribute(this.latency_slider, "max", max_latency)
                set_attribute(this.latency_slider, "title", `Max Latency: ${max_latency} ms`)
                this.playback_rate.value = utils.round_to_factor(this.video.playbackRate * 100, 0.01).toFixed(2);
            } else {
                this.latency.value = 0;
            }

            set_style_property(this.status_light, "background-color", this.is_buffering ? "#f00" : "#0f0");

            if (this.video.muted != this.mute.value) {
                this.video.muted = this.mute.value;
            }
            var target_volume = this.selected.value ? this.volume.value : 0;
            target_volume *= settings.stage_volume.value * stage_volume;
            var num_audible_streams = Stream.get_audible_streams().length;
            if (settings.average_volume_multiple_selected.value && num_audible_streams > 0) {
                target_volume *= calc_volume(num_audible_streams);
            }
            var volume_delta = delta / settings.select_volume_fade_time.value;
            this.real_volume.value = move_to(this.real_volume.value, target_volume, volume_delta);
            if (this.volume_filter) {
                this.volume_filter.parameters.get("volume").value = this.real_volume.value;
                this.video.volume = 1.0;
            } else {
                this.video.volume = this.real_volume.value;
            }

            var color2 = Color(this.color.value);
            if (color2.isLight()) color2 = color2.darken(0.1);
            else color2 = color2.lighten(0.2);
            
            set_style_property(this.video, "width", `${this.scale.value}%`);
            set_style_property(this.video, "height", `${this.scale.value}%`);
            set_style_property(this.video, "left", `${this.offset_x.value}%`);
            set_style_property(this.video, "top", `${this.offset_y.value}%`);
            
            set_inner_html(this.info_element, this.name.value);

            set_text(this.header_name_element, this.name.value);
            set_text(this.header_score_element, format_score(this.score.value));

            set_text(this.header_name_element2, this.name.value);
            set_text(this.header_score_element2,  format_positional(this.position+1));
            set_style_property(this.stream_container, "--color", this.color.value);
            set_style_property(this.stream_container, "order", this.index);
            set_style_property(this.header_element, "order", this.index);
            set_style_property(this.header_element2, "order", this.position);
            set_style_property(this.header_element, "--color", this.color.value);
            set_style_property(this.header_element, "--color2", color2.hex());
            set_style_property(this.header_element2, "--color", this.color.value);
            set_style_property(this.header_element2, "--color2", color2.hex());
            set_style_property(this.stream_container, "--color", this.color.value);
    
            var status = "online";
            if (this.offline_persistant) status = "offline";
            else if (this.is_buffering) status = "buffering";
            set_attribute(this.stream_container, "data-status", status);
    
            toggle_class(this.stream_container, "selected", this.selected.value);
    
            if (this.video.paused) this.video.play();
        } else {
            this.remove_from_stage();
        }
        
        /* if (this.is_buffering && !this.offline) {
            this.offline = true;
            this.offline_time = now;
        } else if (!this.is_buffering && this.offline) {
            this.offline = false;
        } */

        var offline = !(this.data && this.data.publisher);

        if (!offline && this.offline) {
            this.offline = false;
            this.init_video();
        } else if (offline && !this.offline) {
            this.offline = true;
            this.offline_time = now;
        }

        if (this.data && this.data.publisher) {
            var data_str = JSON.stringify(this.data.publisher || {}, null, "  ");
            set_inner_html(this.stream_data_content, data_str);
            this.bitrate.value = Math.round(this.data.bitrate);
        } else {
            set_inner_html(this.stream_data_content, "No data");
            this.bitrate.value = 0;
        }

        this.last_update_time = now;
    }

    destroy() {
        this.remove_from_stage();
        this.properties.remove();
        STREAMS.delete(this)
        clearInterval(this.#per_second_interval_id);
    }

    get_data() {
        return this.properties.get_properties();
    }

    set_data(data) {
        this.properties.set_properties(data);
    }
}

class Challenge extends events.EventEmitter {
    // pre_timer = new Timer();
    // end_timer = new Timer();
    secondaries = new Set();
    round = null;

    get index() { return $(this.properties).index(); }
    get is_active() { return this.status.value >= ChallengeStatus.active_pending[0] && this.status.value <= ChallengeStatus.active_finished[0]; }
    
    static get_challenges() {
        return Array.from(CHALLENGES).sort((a,b)=>a.index-b.index);
    }
    
    static get_current_challenge() {
        return Array.from(CHALLENGES).filter(c=>c.is_active)[0] || null;
    }

    get_secondaries() {
        return Array.from(this.secondaries).sort((a,b)=>a.index-b.index);
    }

    get next_status() { return (+this.status.value+1) % (ChallengeStatus.archived[0]+1) } 

    constructor() {
        super();
        this.properties = create_layout();
        this.properties.classList.add("challenge");
        
        this.game = create_property("game", `Game`, `<input type="text">`);
        this.properties.append(this.game);

        this.description = create_property("description", `Description`, `<textarea rows="3">`);
        this.properties.append(this.description);

        this.is_positional = create_property("is_positional", `Is Positional`, `<input type="checkbox" checked>`);
        this.properties.append(this.is_positional);

        this.secondaries_list = create_list("secondaries", `Secondaries`);
        this.properties.append(this.secondaries_list);
        this.add_secondary_button = create_button(null, "Add Secondary", ()=>new ChallengeSecondary(this));
        this.secondaries_list.append(this.add_secondary_button);

        this.time_limit = create_property("time_limit", `Time Limit`, create_time_input(20*60*1000));
        this.properties.append(this.time_limit);

        this.run_off_time = create_property("run_off_time", `Run-off Time`, create_time_input(5*60*1000));
        this.properties.append(this.run_off_time);

        this.status = create_property("status", `Status`, `<select></select>`);
        for (var k in ChallengeStatus) {
            this.status.add_option(...ChallengeStatus[k]);
        }
        this.properties.append(this.status);
        this.status.addEventListener("update", ()=>setImmediate(()=>this.#on_status_change()));

        this.proceed_button = create_button(null, `Proceed`, ()=>this.status.value = this.next_status);
        this.properties.append(this.proceed_button)

        this.move_buttons = create_move_buttons(this.properties, true);
        this.properties.append(this.move_buttons);
        
        this.destroy_button = create_button(null, `<i class="fas fa-trash-alt"></i>`, ()=>{
            if (this.is_active) return;
            this.destroy()
        });
        this.move_buttons.append(this.destroy_button);
        
        CHALLENGES.add(this);
        
        this.#on_status_change();
    }

    // onload the statuis var is not last so partially loaded challenge gets on_status_change() too early

    #on_status_change() {
        // console.log("on_status_change", this.status.value)
        if (this.is_active) {
            for (var c of Challenge.get_challenges()) {
                if (c == this) continue;
                if (c.is_active) c.status.value = ChallengeStatus.inactive[0];
            }
            if (!round || (round && round.challenge != this)) {
                new Round(this);
            }
        }

        if (this.status.value == ChallengeStatus.inactive[0]) {
            challenges.inactive_challenges.layout.append(this.properties);
        } else if (this.is_active) {
            challenges.active_challenges.layout.append(this.properties);
        } else {
            challenges.archived_challenges.layout.append(this.properties);
        }

        if (this.is_active) {
            copy_scroll(this.properties);
            scrollIntoView(this.properties);
            paste_scroll(this.properties);
        }

        this.emit("status_change", this.status.value);
    }

    update() {
        this.proceed_button.textContent = this.status.get_options()[this.next_status].textContent;
    }

    duplicate() {
        var c = new Challenge();
        c.set_data(this.get_data())
        return c;
    }

    destroy() {
        this.properties.remove();
        CHALLENGES.delete(this);
    }

    get_data() {
        var data = this.properties.get_properties();
        data.secondaries = Array.from(this.secondaries_list.layout.childNodes).map(c=>c.get_properties());
        return data;
    }

    set_data(data) {
        for (var s of Array.from(this.secondaries)) s.destroy();
        
        if (data.secondaries) {
            for (var d of data.secondaries) {
                new ChallengeSecondary(this).layout.set_properties(d)
            }
        }
        this.properties.set_properties(data);
    }
}

class ChallengeSecondary {
    get index() { return $(this.layout).index() }

    get descriptive_text(){
        return `${format_score(this.score.value)} ${this.cumulative.value ? "per" : "="} ${this.text.value}`;
    }

    constructor(challenge) {
        this.challenge = challenge;

        this.layout = create_layout();
        this.text = create_property("text", "Text", `<textarea rows="2"></textarea`);
        this.layout.append(this.text);
        this.score = create_property("score", `Score`, `<input type="number" value="0">`);
        this.layout.append(this.score);
        this.cumulative = create_property("cumulative", `Cumulative`, `<input type="checkbox">`);
        this.layout.append(this.cumulative);
        this.move_buttons = create_move_buttons(this.layout);
        this.destroy_btn = create_button(null, `<i class="fas fa-trash-alt"></i>`, ()=>this.destroy());
        this.move_buttons.append(this.destroy_btn)
        this.layout.append(this.move_buttons);
        
        this.challenge.secondaries_list.layout.append(this.layout);
        this.challenge.secondaries.add(this);
    }

    destroy() {
        this.layout.remove();
        this.challenge.secondaries.delete(this);
    }
}

class RoundResult {
    _position = -1;
    get position() { return this._position }
    get index() { return $(this.layout).index() }

    get main_score() {
        if (this.round.challenge.is_positional.value) return calculate_scoring(this.round.num_players)[this.position];
        else return this.score.value;
    }

    get secondary_score_breakdown() {
        var secondary_scores = this.get_secondary_scores()
        var secondaries = round.challenge.get_secondaries();
        var results = [];
        for (var i = 0; i < Math.min(secondary_scores.length, secondaries.length); i++) {
            var v = secondaries[i].score.value * secondary_scores[i];
            if (v != 0) results.push(v);
        }
        return results;
    }

    get extra_score() { return this.extra.value; }

    get score_breakdown() {
        var scores = [this.main_score, ...this.secondary_score_breakdown];
        if (this.extra_score) scores.push(this.extra_score);
        return scores;
    }

    get total_score() { return utils.sum(this.score_breakdown); }

    /* get position() {
        if (this.round.challenge.is_positional.value) {
            if (this.position_joint_above.value) {
                var previous = $(this.layout).prev()[0];
                if (previous) {
                    return this.round.get_result_from_element(previous).position;
                }
            }
            return this.index;
        } else {
            var results = this.round.get_results();
            var index = results.findIndex((r)=>r===this);
            return calculate_positions(results.map(r.total_score))[index];
        }
    } */

    constructor(round, stream) {
        this.round = round;
        this.stream = stream;
        
        this.layout = create_layout(stream.id);
        this.layout.classList.add("result");

        this.id = create_property("id", "ID", `<input type="hidden">`);
        this.layout.append(this.id);

        this.name = create_property("name", "Name", `<input type="text" value="" disabled>`);
        this.layout.append(this.name);

        this.position_group = create_layout("position_group");
        this.position_group.classList.add("horizontal", "noscroll");
        this.position_group.append(create_label("Position"));
        this.position_elem = create_property("position", null, `<input type="number" value="0" disabled>`);
        this.position_group.append(this.position_elem);
        this.position_joint_above = create_property("position_joint", null, `<input type="checkbox" title="Same as above">`);
        this.position_group.append(this.position_joint_above);
        this.layout.append(this.position_group);

        this.score = create_property("score", "Score", `<input type="number" value="0">`);
        this.layout.append(this.score);

        this.secondaries_list = create_list("secondaries", "Secondaries");
        this.secondaries_list.layout.classList.add("horizontal", "noscroll");
        this.layout.append(this.secondaries_list);

        this.extra = create_property("extra", "Extra", `<input type="number" value="0">`);
        this.layout.append(this.extra);
        
        this.calculated_score = create_property("calculated_score", "Total Score", `<input type="number" value="0" disabled>`);
        this.layout.append(this.calculated_score);

        this.move_buttons = create_move_buttons(this.layout, true);
        this.destroy_btn = create_button(null, `<i class="fas fa-trash-alt"></i>`, ()=>this.destroy());
        this.move_buttons.append(this.destroy_btn);
        this.layout.append(this.move_buttons);
        
        this.pos_btn = create_button(null, `Declare`, ()=>{
            play_sound("assets/success_2.wav")
            var text = this.round.challenge.is_positional.value ? `${format_positional(this.position+1)}` : `WINNER!`;
            var final_position = $(`<div class="final-position"><span>${text}</span></div>`)[0];
            this.stream.overlay_element.append(final_position);
            setTimeout(()=>final_position.remove(), 10000);
        });
        this.layout.append(this.pos_btn);

        round.results_list.layout.append(this.layout);
        round.results.add(this);

        this.update();
    }

    update() {
        var secondaries = this.round.challenge.get_secondaries();
        secondaries.forEach((s,i)=>{
            var id = `secondary_${i}`;
            var prop = $(this.secondaries_list.layout).find(">#"+id)[0];
            if (!prop) {
                prop = create_property(id, null, `<input type="number" value="0" min ="0">`);
                this.secondaries_list.layout.append(prop);
            }
            set_attribute(prop.input, "title", `${s.descriptive_text}`);
        });
        for (var i=secondaries.length; i<this.secondaries_list.layout.childElementCount; i++) {
            this.secondaries_list.layout.childNodes[i].remove();
        }

        toggle_class(this.position_group, "display-none", !this.round.challenge.is_positional.value);
        toggle_class(this.pos_btn, "display-none", !this.round.challenge.is_positional.value);
        toggle_class(this.score, "display-none", this.round.challenge.is_positional.value);
        toggle_class(this.secondaries_list, "display-none", secondaries.length==0);

        this.name.value = this.stream.name.value;
        this.position_elem.value = this.position;
        this.calculated_score.value = this.total_score;
    }

    get_secondary_scores() {
        return Array.from(this.secondaries_list.layout.childNodes).map(p=>p.value);
    }

    destroy() {
        this.layout.remove();
        this.round.results.delete(this);
    }
}

// ---------------------------------------

class Screen extends events.EventEmitter {
    element;

    get index() { return $(this.properties).index(); }

    constructor(title="") {
        super();
        this.element = $(`<div class="screen"></div>`)[0];
        screens_container.append(this.element);
        SCREENS.add(this);

        this.properties = create_layout();
        this.properties.classList.add("screen");

        this.title = create_property(null, this.title, `<input type="text" disabled>`);
        this.title.value = title;
        this.properties.append(this.title);
        var move_buttons = create_move_buttons();
        this.destroy_button = create_button(null, `<i class="fas fa-trash-alt"></i>`, ()=>this.destroy());
        move_buttons.append(this.destroy_button);
        this.properties.append(move_buttons);
        settings.screen_list.layout.append(this.properties);
    }

    destroy() {
        this.element.classList.add("closing");
        setTimeout(()=>this.element.remove(), 2000);
        this.properties.remove();
        SCREENS.delete(this);
    }

    update() {
        set_style_property(this.element, "z-index", `${99-this.index}`);
    }

    static clear() {
        for (var s of Array.from(SCREENS)) {
            s.destroy();
        }
    }
}

class ChallengeStartScreen extends Screen {
    constructor(round) {
        super("Start Screen");
        this.round = round
        this.element.classList.add("countdown");
        utils.timeout(2000)
        .then(()=>{
            play_sound("assets/beep1.wav")
            $(this.element).append(`<div class="num">3</div>`)
            return utils.timeout(1000)
        })
        .then(()=>{
            play_sound("assets/beep1.wav")
            $(this.element).append(`<div class="num">2</div>`)
            return utils.timeout(1000)
        })
        .then(()=>{
            play_sound("assets/beep1.wav")
            $(this.element).append(`<div class="num">1</div>`)
            return utils.timeout(1000)
        })
        .then(()=>{
            this.emit("go")
            play_sound("assets/beep2.wav")
            $(this.element).append(`<div class="num">GO!</div>`)
            
            send_to_discord(format_discord_big("GO"));
            
            this.round.challenge.status.value = ChallengeStatus.active[0];

            return utils.timeout(1000)
        })
        .then(()=>{
            this.destroy();
        });
    }
}

class ChallengeDetailsScreen extends Screen {
    challenge;
    constructor(round) {
        super();
        this.round = round
        this.element.classList.add("details");
        this.box = $(`<div class="box"></div>`)[0];
        this.render()

        setTimeout(()=>{
            play_sound("assets/round_begin.mp3");
            this.element.append(this.box);
        },1000)
    }

    render() {
        var box = document.createElement("div");
        this.title.value = `Round ${settings.round_num.value}`;

        var title = $(`<div class="title">${this.title.value}</div>`)[0];
        box.append(title);

        var row = $(`<div class="row"></div>`)[0];
        $(row).append(`<label>Game(s):</label>`)
        var game = $(`<span><b>${this.round.challenge.game.value || "N/A"}</b></span>`)[0];
        row.append(game);
        box.append(row);

        if (this.round.challenge.description.value) {
            var row = $(`<div class="row"></div>`)[0];
            $(row).append(`<label>Description:</label>`)
            var description = $(`<div class="description">${nl2br(this.round.challenge.description.value)}</div>`)[0]
            row.append(description);
            box.append(row);
        }

        if (this.round.challenge.is_positional.value) {
            var row = $(`<div class="row"></div>`)[0];
            $(row).append(`<label>Scoring:</label>`)
            var table = $(`<div class="scoring_table"></div>`)[0]
            calculate_scoring(this.round.num_players).forEach((e,i)=>{
                $(table).append(`<div><i>${format_positional(i+1)}</i> = <b>${format_score(e)}</b></div>`)
            });
            $(row).append(table);
            box.append(row);
        }

        var secondaries = this.round.challenge.get_secondaries()
        //.sort((a,b)=>b.score.value-a.score.value)
        if (secondaries.length > 0) {
            var row = $(`<div class="row"></div>`)[0];
            $(row).append(`<label>Additional:</label>`);
            var list = $(`<ul class="secondaries"></ul>`)[0];
            for (var s of secondaries) {
                var item = $(`<li>${nl2br(s.descriptive_text)}</li>`)[0];
                list.append(item);
            }
            row.append(list);
            box.append(row);
        }
        
        // var time_limit = utils.time_str_to_ms(challenge.time_limit.value)
        if (this.round.challenge.time_limit.value) {
            $(box).append(`<div class="separator"></div>`);
            var row = $(`<div class="row"></div>`)[0];
            $(row).append(`<label>Time Limit:</label>`)
            $(row).append(`<div class="time-limit">${utils.time_to_str(this.round.challenge.time_limit.value)}</div>`)
            box.append(row);

            if (this.round.challenge.run_off_time.value) {
                var row = $(`<div class="row"></div>`)[0];
                $(row).append(`<label>Run-off Time:</label>`)
                $(row).append(`<div class="time-limit">${utils.time_to_str(this.round.challenge.run_off_time.value)}</div>`)
                box.append(row);
            }
        }

        set_inner_html(this.box, box.innerHTML)
    }

    update() {
        super.update();
        this.render()
        // this.time_to_start.textContent = format_duration(this.round.timer.time_left+999,{leading:true});
    }
}

class RoundResultsScreen extends Screen {
    round;
    constructor(round) {
        super();
        this.round = round
        this.box = $(`<div class="box" style="width:100%"></div>`)[0];
        this.render()

        setTimeout(()=>{
            play_sound("assets/round_over.mp3");
            this.element.append(this.box);
        }, 1000);
    }

    render() {
        this.title.value = `Round ${settings.round_num.value} Results`;
        var title = $(`<div class="title">${this.title.value}</div>`)[0];
        var box = document.createElement("div");
        box.append(title);

        var table_elem = $(`<table class="results"><tbody></tbody></table>`)[0];
        var tbody = table_elem.childNodes[0];

        var results = this.round.get_results();
        this.round.calculate_positions(results);
        results = results.map(r=>{
            var position = format_positional(r.position+1);
            var name = r.stream.name.value;
            var score = format_score(r.total_score);
            var breakdown = r.score_breakdown;
            breakdown = (breakdown.length > 1) ? format_score_breakdown(breakdown) : undefined;
            return {
                position,
                name,
                score,
                breakdown,
            };
        });
        if (results.every(r=>r.breakdown===undefined)) {
            results.forEach(r=>delete r.breakdown);
        }
        var table = results.map((r)=>Object.keys(r).map(k=>`<td class="${k}">${r[k]}</td>`));
        table = mathjs.transpose(table);

        tbody.innerHTML = table.map((r)=>`<tr>${r.join("")}</tr>`).join("");
        // Array.from(tbody.getElementsByClassName("name")).map(e=>e.style.setProperty("--color", this.color))

        box.append(table_elem);

        set_inner_html(this.box, box.innerHTML);
    }

    update() {
        super.update();
        this.render();
    }
}


// -------------------------------

function api_refresh() {
    new Promise((resolve, reject) => {
        $.ajax({
            url: `http://${server.NMS_AUTH_USERNAME}:${server.NMS_AUTH_PASSWORD}@localhost:${server.NMS_HTTP_PORT}/api/streams`,
            dataType: 'json',
            success: (response)=>resolve(response),
            error: ()=>resolve(null)
        });
    }).then((result)=>{
        if (!result) return;
        var old_server_streams = server_streams;
        server_streams = result[server.NMS_APP_NAME] || {};
        
        for (var k in server_streams) {
            s_old = old_server_streams[k];
            s = server_streams[k];
            s.time = +new Date();
            if (s.publisher) {
                var stream = Stream.fetch(k); //create or get stream by id
                var old_bytes = s.publisher.bytes;
                var old_time = s.time - 1000;
                if (s_old && s_old.publisher) {
                    old_bytes = s_old.publisher.bytes;
                    old_time = s_old.time;
                }
                s.bitrate = (s.publisher.bytes - old_bytes) / ((s.time - old_time) / 1000) / 1024 * 8;
            }
        }
    });
}

function recalculate_layout() {
    const container_width = stage.offsetWidth;
    const container_height = stage.offsetHeight;

    var streams = Stream.get_visible_streams();
    const num_videos = streams.length;
    var aspect_ratio = settings.aspect_ratio;
    let layout = {
        area: 0,
        cols: 0,
        rows: 0,
        width: 0,
        height: 0
    };

    // brute-force search layout where video occupy the largest area of the container
    for (let cols = 1; cols <= num_videos; cols++) {
        const rows = Math.ceil(num_videos / cols);
        const hScale = container_width / (cols * aspect_ratio);
        const vScale = container_height / rows;
        let width;
        let height;
        if (hScale <= vScale) {
            width = Math.floor(container_width / cols);
            height = Math.floor(width / aspect_ratio);
        } else {
            height = Math.floor(container_height / rows);
            width = Math.floor(height * aspect_ratio);
        }
        const area = width * height;
        if (area > layout.area) {
            layout = {
                area,
                width,
                height,
                rows,
                cols
            };
        }
    }
    var num_rows = layout.rows;
    var row_height = Math.floor(container_height/layout.rows);
    var row_width = layout.cols * layout.width;

    if (settings.crop_video.value) layout.height = row_height;
    for (var i=0; i<num_videos; i++) {
        var stream = streams[i];
        var elem = stream.stream_container;
        var row = Math.floor(i/layout.cols);
        var col = i % layout.cols;
        var num_cols = Math.min(layout.cols, num_videos - (row * layout.cols));
        var col_width = layout.width;
        var row_height = layout.height;
        var top = (row+1) * (container_height - row_height * num_rows) / (num_rows + 1) + (row * row_height);
        var left = (col+1) * (row_width - col_width * num_cols) / (num_cols + 1) + (col * col_width) + (container_width - row_width) / 2;
        // pad_left += ((row_width / layout.cols) - layout.width) / 2;
        // pad_left += ((row_width - num_on_row * layout.width) / (num_on_row * 2));
        //(container_width - num_on_row * layout.width) / 2;
        set_style_property(elem, "width", `${col_width}px`);
        set_style_property(elem, "height", `${row_height}px`);
        set_style_property(elem, "top", `${top}px`);
        set_style_property(elem, "left", `${left}px`);
        // set_style_property(elem, "margin", `${pad_top}px ${pad_left}px`);
    }
}
/* var custom_css_props = ["--width", "--height", "--row-height"];
for (var p of custom_css_props) {
    CSS.registerProperty({
        name: p,
        syntax: "<number>",
        initialValue: 0,
        inherits: false
    });
}
custom_css_props = ["--cols", "--rows"];
for (var p of custom_css_props) {
    CSS.registerProperty({
        name: p,
        syntax: "<integer>",
        initialValue: 0,
        inherits: false
    });
} */

var header_timeline;
function update_header() {
    if (header_timeline) header_timeline.stop();
    header_timeline = new Timeline([
        ()=>{
            header.style.setProperty("top", `0`);
            setTimeout(()=>header_positions.style.setProperty("opacity", `0.0`), 500);
        },
        settings.header_title_duration.value,
        ()=>header.style.setProperty("top", `-100%`),
        settings.header_scores_duration.value,
        ()=>header_positions.style.setProperty("opacity", `1.0`),
        settings.header_positions_duration.value,
    ], { loop:true, autostart:true });
}

var footer_timeline;
function update_footer() {
    if (footer_timeline) footer_timeline.stop();
    footer_timeline = new Timeline([
        ()=>footer.style.setProperty("top", `0`),
        settings.footer_title_duration.value,
        ()=>{
            if (!footer_info.firstChild) return;
            footer.style.setProperty("top", `-100%`)
            $(footer_info).stop();
            $(footer_info).css({ left: `${footer_info.offsetWidth}px` });

            return utils.timeout(500)
            .then(()=>new Promise((resolve)=>{
                // var distance = footer_info.firstChild.offsetWidth - footer_info.offsetWidth;
                var distance = footer_info.firstChild.offsetWidth + footer_info.offsetWidth;
                var time = Math.abs(distance/settings.footer_info_speed.value)*1000;
                $(footer_info).stop();
                $(footer_info).animate({ left: `-=${distance}px` }, time, "linear", ()=>resolve());
            }))
            .then(()=>utils.timeout(0));
        },
    ], { loop:true, autostart:true });
}

class Timeline {
    #i = -1;
    #total = 0;
    #is_running = false;
    #timeline;
    #options;

    get is_running() { return this.#is_running; }

    constructor(timeline, options={}) {
        this.#timeline = timeline;
        this.#options = options;
        if (options.autostart) this.next();
    }
    
    next() {
        this.#total++;
        this.#i++;
        this.#is_running = true;
        
        if (this.#i >= this.#timeline.length && this.#options.loop) {
            if (typeof this.#options.loop == "number") this.#options.loop--;
            this.#i = 0;
        }

        if (this.#i >= this.#timeline.length) {
            this.stop();
            return;
        }

        var total = this.#total;
        var next = ()=>{
            if (this.#total === total && this.#is_running) this.next();
        }
        var type = typeof this.#timeline[this.#i];
        if (type == "number") {
            setTimeout(()=>next(), this.#timeline[this.#i]);
        } else if (type == "function") {
            Promise.resolve(this.#timeline[this.#i]()).then(()=>next());
        } else {
            console.log(`'${this.#timeline[this.#i]}' not a valid timeline entry. Waiting 1000ms...`)
            setTimeout(()=>next(), 1000);
        }
    }

    stop() {
        this.#is_running = false;
    }
}

class Timer extends events.EventEmitter {
    #stopwatch = new StopWatch();
    #total_time = 0;
    #interval_id;
    #last_seconds_left;
    static TICK_INTERVAL = 1000/60;
    
    get time_left() { return Math.max(0, this.#total_time - this.#stopwatch.time); }
    get seconds_left() { return Math.ceil(this.time_left/1000); }
    get finished() { return this.time_left <= 0; }
    get paused() { return this.#stopwatch.paused; }

    constructor() {
        this.#stopwatch.on("pause", ()=>{
            clearInterval(this.#interval_id);
            this.emit("pause");
        });
        this.#stopwatch.on("start", ()=>{
            this.#interval_id = setInterval(()=>this.#tick(), Timer.TICK_INTERVAL);
            this.emit("start");
        })
        this.#stopwatch.on("reset", ()=>{
            this.#last_seconds_left = this.seconds_left;
            this.emit("reset");
        })
    }

    restart(time) {
        this.#total_time = time;
        this.#stopwatch.reset();
    }

    #tick() {
        var seconds_left = this.seconds_left;
        for (var i = this.#last_seconds_left-1; i >= seconds_left; i--) {
            this.emit("second", i);
        }
        this.#last_seconds_left = seconds_left;
        this.emit("tick");
        if (this.finished) {
            clearInterval(this.#interval_id);
            this.emit("finish");
        }
    }

    pause() {
        this.#stopwatch.pause();
    }

    resume() {
        this.#stopwatch.resume();
    }

    reset() {
        this.#stopwatch.reset();
    }

    destroy() {
        this.#stopwatch.destroy();
        this.removeAllListeners();
    }
}

class StopWatch extends events.EventEmitter {
    #start_time = 0;
    #pause_time = 0;
    
    get time() { return (this.paused) ? (this.#pause_time - this.#start_time) : (+new Date() - this.#start_time); }
    get paused() { return this.#pause_time != 0; }
    
    start() {
        if (!this.#start_time) this.#start_time = +new Date();
        if (!this.paused) return;
        this.#start_time += +new Date() - this.#pause_time;
        this.#pause_time = 0;
        this.emit("start");
    }
    
    resume() {
        this.start();
    }
    
    pause() {
        if (this.paused) return;
        this.#pause_time = +new Date();
        this.emit("pause");
    }

    reset() {
        this.#start_time = +new Date();
        if (this.paused) this.#pause_time = new Date();
        this.emit("reset");
    }

    destroy() {
        this.removeAllListeners();
    }
}

// --------------------------------------------

function tick() {
    var now = +new Date();
    var delta = now - last_tick;

    var stage_volume_target = 1.0;
    if (SCREENS.size) stage_volume_target = settings.stage_volume_screen.value;
    stage_volume = move_to(stage_volume, stage_volume_target, delta/1000);

    // ---------

    var visible_streams = Stream.get_visible_streams();
    for (var s of Stream.get_streams()) {
        toggle_class(s.stream_container, "display-none", !visible_streams.includes(s));
    }

    if (settings.always_one_stream_selected.value) {
        if (visible_streams.length > 0) {
            var num_selected = visible_streams.reduce((t,s)=>t+(s.selected.value?1:0), 0);
            if (num_selected == 0) {
                visible_streams[0].select();
            }
        }
    }
    toggle_class(stage, "crop", settings.crop_video.value);
    Stream.calculate_positions();
    for (var s of Stream.get_streams()) {
        s.update();
    }
    for (var c of Challenge.get_challenges()) {
        c.update();
        if (round && round.challenge != c) {
            c.status.set_disabled(true)
        } else {
            c.status.set_disabled(false)
        }
    }
    settings.update();
    for (var s of SCREENS) {
        s.update();
    }
    // stage_volume += (stage_volume_target-stage_volume)*0.1;
    // console.log(stage_volume)
    // // if (Math.abs(stage_volume_target-stage_volume) < 0.01) stage_volume = stage_volume_target;
    // ---------
    rem = 16*settings.zoom_factor.value;
    if (settings.adapt_to_window_size.value) {
        rem *= window.innerHeight / 720;
    }
    set_text(round_name, `Round ${settings.round_num.value}`);
    if (round) {
        round.update();

        set_text(round_timer, utils.time_to_str(round.timer.time_left+999, "hh:mm:ss"));
        toggle_class(round_timer, "finished", round.timer.time_left == 0);
        set_text(footer_game, `${round.challenge.game.value}` || "N/A");
        var parts = [nl2br(round.challenge.description.value, " ")];
        for (var s of round.challenge.get_secondaries()) {
            parts.push(nl2br(s.descriptive_text, " "));
        }
        set_inner_html(footer_info, `<span>${parts.join(`<span class="marquee-separator">•</span>`)}</span>`);
    } else {
        set_text(round_timer, "--:--:--");
        set_text(footer_game, "");
        set_inner_html(footer_info, "");
    }
    set_style_property(screens_container, "opacity", settings.screen_opacity.value);

    set_style_property(document.documentElement, "font-size", `${rem}px`);
    
    recalculate_layout();

    api_refresh_interval.interval = settings.api_refresh_interval.value;
    
    last_tick = now;
}

var streams = new Streams();
streams.open();

var challenges = new Challenges();
challenges.open();

var settings = new Settings();
settings.open();

window.addEventListener('mousewheel', (e)=>{
    if (e.ctrlKey) {
        if (e.wheelDeltaY < 0) settings.zoom_factor.value -= 0.1;
        else if (e.wheelDeltaY > 0)  settings.zoom_factor.value += 0.1;
    }
});

var num_keys = ["1","2","3","4","5","6","7","8","9","0"];
var ctrlToggle = false;
var altToggle = false;
var selection = new Set()
document.addEventListener("keydown", (e)=>{
    ctrlToggle = e.ctrlKey;
    altToggle = e.altKey;
    if (num_keys.includes(e.key)) {
        if (ctrlToggle || altToggle) selection.add(e.key)
    }
});
document.addEventListener("keyup", (e)=>{
    if (selection.size > 0) {
        if (selection.has("0")) selection = new Set(num_keys);
        if (ctrlToggle && e.key == "Control") {
            Stream.get_added_streams().forEach(s=>s.hidden.value=!selection.has(`${s.index+1}`))
            selection.clear();
        } else if (altToggle && e.key == "Alt") {
            Stream.get_added_streams().forEach(s=>s.hidden.value=selection.has(`${s.index+1}`))
            selection.clear();
        }
    }
});

header_wrapper.addEventListener("click", ()=>{
    if (header_timeline) header_timeline.next();
})

footer_wrapper.addEventListener("click", ()=>{
    if (footer_timeline) footer_timeline.next();
})

// const debouncedRecalculateLayout = _.debounce(recalculateLayout, 50);
// window.addEventListener("resize", ()=>debouncedRecalculateLayout());
setInterval(()=>tick(), TICK_RATE);

setInterval(()=>autosave(), AUTOSAVE_INTERVAL);
window.addEventListener("beforeunload", ()=>{
    for (var w of CONTROL_PANELS) {
        w.destroy();
    }
    autosave();
});

autoload();

api_refresh();
var api_refresh_interval = new utils.IntervalCallback(api_refresh, settings.api_refresh_interval.value);

update_header();
update_footer();

// IMPORTANT:
/*
- weird audio issue with web audio worklets / voicemeeter vb cables, latency continually builds, video slows down. weird!
*/

// AREAS FOR IMPROVEMENT
/*
x BETTER FORMATTING ON CONTROL PANEL ETC.
x NORMALIZE MEGADRIVE AUDIO, REDUCE TO ABOUT 50% MAX
x RECORD DESKTOP AUDIO AND GAME AUDIO SEPARATELY
x MAKE PLAYER NAMES BETTER DEFINED ON STREAM
x ORDER NAMES AT TOP OF SCREEN IN ORDER OF POSITION OVERALL AND SHOW POSITION NEXT TO NAME
x LATENCY SEEMED TO GET BIGGER THE LONGER TOURNAMENT WENT ON, LOOK INTO.
x PREVENT START SCREEN COUNTDOWN REPEATING ON RELOADING (ADD ANOTHER STATUS)
x AUTO-POST DETAILS, RESULTS, TOTAL SCORES TO DISCORD
- REQUEST ALL PLAYERS TO SUBMIT THEIR HIGH SCORES AND / OR SENCONDARY TASKS / PENALTIES AT THE END OF EVERY ROUND AUTOMATICALLY
- AUTO-PROCEED AFTER ROUND START
- SEND DISCORD MESSAGES AS IMAGES OF RENDERED HTML?
- SEND DISCORD MESSAGES WHEN TIME IS RUNNING OUT (5 MINS 1 MIN)
- CONNECTION STATUS VISUALIZATION FOR EACH PLAYER, LAGGY, DROPPING FRAMES, ETC.
- RUN-OFF TIME MAKE CLEARER. REMOVE ALL TOGETHER?
- INDIVIDUAL PLAYER A/V SYNC (delay - easy, video faster - NOT POSSIBLE?)

- TEST MIC LEVELS BEFORE GOING LIVE, MAKE MICS LOUDER THAN GAMES
- DIRECT FEED TO DELETE FOR ISSUING IMPORTANT INFO TO PLAYERS
*/