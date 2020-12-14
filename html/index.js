const electron = require('electron');
const _ = require('lodash');
const $ = jQuery = require('jquery');
const flvjs = require("flv.js");
const fs = require("fs");
const events = require("events");

const utils = require("../utils");
const server = require("../server");
const ui = require("./ui");

const TEST = true;

const stage = document.getElementById("stage");
var cp_window;
var cp = null;

/* function get_aspect_ratio(){
    var ar = this.default_aspect_ratio.value
    if (ar) return ar;
    try {
        return this.custom_aspect_ratio_width.value / this.custom_aspect_ratio_height.value;
    } catch {
        return 4/3;
    }
} */

function get_stream(id) {
    for (var s of get_streams()) {
        if (s._id == id) return s;
    }
    return null;
}

function get_streams() {
    return $("ui-stream").toArray();
}

/* function get_input(e) {
    return $(e).filter("input textarea select")[0] || $(e).find("input textarea select")[0] || null;
}

function get_value(e) {
    var input = get_input(e);
    if (input.nodeName === "input" && input.type === "checkbox") {
        return input.checked;
    }
    try {
        return JSON.parse(input.value)
    } catch {
        return input.value;
    }
}

function set_value(e, value, trigger_change=true) {
    var input = get_input(e);
    if (input.nodeName === "input" && input.type === "checkbox") {
        input.checked = value;
    } else {
        input.value = value;
    }
} */

/* save(filePath){
    var data = JSON.stringify(this.get_data(), null, "  ");
    fs.writeFileSync(filePath, data);
}

save_dialog(){
    var result = await electron.remote.dialog.showSaveDialog({
        defaultPath: 'SaveData.json',
    });
    if (result.filePath) this.save(result.filePath)
}

load(filePath){
    
} */

class ControlPanel extends ui.PropertyGroup {
    constructor() {
        super();

        this._streams = new ui.PropertyGroup("Streams");
        this.append(this._streams);

        // ---------------------------

        this._challenges = new ui.PropertyGroup("Challenges");

        this._add_challenge_btn = new ui.Button(`Add Challenge`, ()=>{
            new Challenge()
        });
        this._challenges._container.append(this._add_challenge_btn);

        this._active_challenges_list = new ui.PropertyGroup("Active");
        this._challenges._container.append(this._active_challenges_list);

        this._inactive_challenges_list = new ui.PropertyGroup("Inactive");
        this._challenges._container.append(this._inactive_challenges_list);

        this._completed_challenges_list = new ui.PropertyGroup("Completed");
        this._challenges._container.append(this._completed_challenges_list);

        this.append(this._challenges);

        // ---------------------------

        this._settings = new ui.PropertyGroup("Settings");
        
        this._max_buffer_delay = new ui.Property(`Max Buffer Delay (ms)`, `<input type="number" min="10" max="10000" step="10" value="1500">`);
        this._settings._container.append(this._max_buffer_delay);

        this._min_buffer_time = new ui.Property(`Min Buffer Time (ms)`, `<input type="number" min="10" max="5000" step="10" value="500">`);
        this._settings._container.append(this._min_buffer_time);

        this._api_refresh_interval = new ui.Property(`API Refresh Interval`, `<input type="number" min="0" max="10000" step="100" value="1000">`);
        this._settings._container.append(this._api_refresh_interval);

        this._auto_add_to_stage = new ui.Property(`Auto Add to Stage`, `<input type="checkbox" checked>`);
        this._settings._container.append(this._auto_add_to_stage);

        this._default_aspect_ratio = new ui.Property(`Default Aspect Ratio`, `<select></select>`);
        this._default_aspect_ratio.append($(`<option value="${4/3}">4:3</option>`)[0]);
        this._default_aspect_ratio.append($(`<option value="${16/9}">16:9</option>`)[0]);
        this._default_aspect_ratio.append($(`<option value="null">Custom</option>`)[0]);
        this._settings._container.append(this._default_aspect_ratio);

        // this.default_aspect_ratio.input.addEventListener("change", ()=>{});

        var group = new ui.PropertyGroup();
        group.orientation = ui.Horizontal;
        this._custom_aspect_ratio_width = new ui.Property(`Custom Aspect Ratio (Width)`, `<input type="number" value="4">`);
        group._container.append(this._custom_aspect_ratio_width);
        group._container.append($(`<span>:</span>`)[0]);
        this._custom_aspect_ratio_height = new ui.Property(`Custom Aspect Ratio (Height)`, `<input type="number" value="3">`);
        group._container.append(this._custom_aspect_ratio_height);
        this._settings._container.append(group);

        this.append(this._settings);
    }
}

class Stream extends ui.PropertyGroup {
    _id = null;
    _video = null;
    _flv_player = null;
    _data = null;

    constructor(id) {
        super();
        this._id = id;
        
        this._added = new ui.Property(`Added`, `<input type="checkbox">`);
        this.append(this._added);

        this._hidden = new ui.Property(`Hidden`, `<input type="checkbox">`);
        this.append(this._hidden);

        this._focused = new ui.Property(`Focused`, `<input type="checkbox">`);
        this.append(this._focused);

        this._color = new ui.Property(`Color`, `<input type="color" value="#000000">`);
        this.append(this._color);

        this._name = new ui.Property(`Name`, `<input type="text" value="${id}">`);
        this.append(this._name);

        this._score = new ui.Property(`Score`, `<input type="number" value="0">`);
        this.append(this._score);

        this._volume = new ui.Property(`Volume`, `<input type="range" min="0" max="100" value="100">`);
        this.append(this._volume);

        this._mute = new ui.Property(`Mute`, `<input type="checkbox">`);
        this.append(this._mute);

        this._added._input.addEventListener("change", ()=>{
            if (this._added.value) this.#add_to_stage();
            else this.#remove_from_stage();
        });
        this._hidden._input.addEventListener("change", ()=>{
            recalculate_layout();
        });
        this._focused._input.addEventListener("change", ()=>{
            recalculate_layout();
        });

        if (cp._auto_add_to_stage.value) {
            this._added.set_value(true);
        }
        
        cp._streams._container.append(this);
    }

    #add_to_stage() {
        if (this._added.value) return;
        this._added.value = true;

        this._stage_element = document.createElement("div");
        this._stage_element.classList.add("video-container");
        this._stage_element.setAttribute("data-id", this._id);

        this._video = document.createElement("video");
        // this.video.toggleAttribute("controls");
        this._video.muted = true;
        this._stage_element.append(this._video);

        this._flv_player = flvjs.createPlayer({
            type: 'flv',
            url: `ws://localhost:${server.NMS_HTTP_PORT}/${server.NMS_APP_NAME}/${this._id}.flv`,
            isLive: true,
        },{
            enableStashBuffer: false
        });

        this._flv_player.attachMediaElement(this._video);
        this._flv_player.load();
        this._flv_player.play();
        this._video.addEventListener('progress', ()=>{
            var end = this._flv_player.buffered.end(0) * 1000;
            var time = this._flv_player.currentTime * 1000;
            var delta = end - time;
            if (delta > cp.max_buffer_delay.value) {
                this._flv_player.currentTime = (end - cp.min_buffer_time.value) / 1000;
            }
        });

        stage.append(this._stage_element);

        recalculate_layout();
    }

    #remove_from_stage() {
        if (!this._added.value) return;
        this._added.value = false;
        
        this._video.pause();
        this._video.removeAttribute('src');
        this._video.load();
        
        recalculate_layout();
    }

    destroy() {
        this.#remove_from_stage();
        this.remove();
    }
}

class Challenge extends ui.PropertyGroup {
    constructor() {
        super();
        this._game = new ui.Property(`Game`, `<input type="text">`);
        this.append(this._game);

        this._rules = new ui.Property(`Rules`, `<input type="text">`);
        this.append(this._rules);

        this._time_limit = new ui.Property(`Time Limit`, `<input type="number">`);
        this.append(this._time_limit);

        this._run_off_time = new ui.Property(`Run off Time`, `<input type="number">`);
        this.append(this._run_off_time);

        this._move_buttons = new MoveButtons();
        this.append(this._move_buttons);

        this._start_button = new ui.Button("Start", this.start);
        this.append(this._start_button);

        this._end_button = new ui.Button("End", this.end);
        this.append(this._end_button);
        
        cp._inactive_challenges_list.append(this);
    }

    start() {
        this._start_time = +new Date();
        cp._active_challenges_list.append(this);
    }

    end() {
        cp._completed_challenges_list.append(this);
    }
}

class MoveButtons extends ui.PropertyGroup {
    constructor() {
        super();
        this.orientation = ui.Horizontal;
        this._move_down_btn = new ui.Button(`Move Down`, ()=>{
            move_element_down(this);
        });
        this._container.append(this._move_down_btn);
        this._move_up_btn = new ui.Button(`Move Up`, ()=>{
            move_element_up(this);
        });
        this._container.append(this._move_up_btn);
        this._move_top_btn = new ui.Button(`Move Top`, ()=>{
            set_element_index(this, 0)
        });
        this._container.append(this._move_top_btn);
        this._move_bottom_btn = new ui.Button(`Move Bottom`, ()=>{
            set_element_index(this, this.parentElement.childElementCount-1)
        });
        this._container.append(this._move_bottom_btn);
    }
}

// -------------------------------

function move_element_up(e) {
    set_element_index(e, $(e).index()-1);
}

function move_element_down(e) {
    set_element_index(e, $(e).index()+1);
}

function set_element_index(e, i) {
    if (i >= e.childElementCount) e.parentElement.append(e);
    else e.parentElement.insertBefore(e, e.parentElement.childNodes[Math.max(0, i)]);
}

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
        for (var k in result.live) {
            s = result.live[k];
            if (s.publisher.app === server.NMS_APP_NAME) {
                var stream = get_stream(k) || new Stream(k)
                stream.data = s;
            }
        }
    });
}

function toggle_control_panel(){
    if (cp_window && !cp_window.closed) {
        cp_window.close()
        cp_window = null;
    } else {
        cp_window = window.open("./admin.html", "Control Panel", "width=720,height=480");
        cp_window.onload = ()=>cp_window.document.body.append(cp);
    }
}

function recalculate_layout() {
    const containerWidth = document.body.getBoundingClientRect().width;
    const containerHeight = document.body.getBoundingClientRect().height;
    // const [containerWidth, containerHeight] = electron.remote.getCurrentWindow().webContents.getOwnerBrowserWindow().getSize()
    // console.log(containerWidth, containerHeight)
    var streams = get_streams().filter(s=>s.pAdded.value && !s.pHidden.value);
    if (streams.some(s=>s.pFocused)) {
        streams = streams.filter(s=>s.pFocused);
    }
    for (var s of get_streams()) {
        if (streams.includes(s)) s.container.classList.remove("display-none");
        else s.container.classList.add("display-none");
    }
    const videoCount = streams.length;
    var aspectRatio = cp.aspect_ratio;
    let bestLayout = {
        area: 0,
        cols: 0,
        rows: 0,
        width: 0,
        height: 0
    };

    // brute-force search layout where video occupy the largest area of the container
    for (let cols = 1; cols <= videoCount; cols++) {
        const rows = Math.ceil(videoCount / cols);
        const hScale = containerWidth / (cols * aspectRatio);
        const vScale = containerHeight / rows;
        let width;
        let height;
        if (hScale <= vScale) {
            width = Math.floor(containerWidth / cols);
            height = Math.floor(width / aspectRatio);
        } else {
            height = Math.floor(containerHeight / rows);
            width = Math.floor(height * aspectRatio);
        }
        const area = width * height;
        if (area > bestLayout.area) {
            bestLayout = {
                area,
                width,
                height,
                rows,
                cols
            };
        }
    }

    stage.style.setProperty("--width", bestLayout.width + "px");
    stage.style.setProperty("--height", bestLayout.height + "px");
    stage.style.setProperty("--cols", bestLayout.cols + "");
}

// --------------------------------------------

cp = new ControlPanel();

if (TEST) {
    for (var i = 0; i < 5; i++) {
        new Stream(`Test Stream ${i+1}`);
    }
} else {
    api_refresh();
    utils.set_maximum_interval(api_refresh, cp._api_refresh_interval.value);
}

// const debouncedRecalculateLayout = _.debounce(recalculateLayout, 50);
window.addEventListener("resize", recalculate_layout);
recalculate_layout();

electron.ipcRenderer.on('toggle_control_panel', ()=>{
    toggle_control_panel()
});
toggle_control_panel();