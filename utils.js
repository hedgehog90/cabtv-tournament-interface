var maximum_interval_timeouts = new Map();
const FLT_EPSILON = 1.19209290e-7;

const utils = {

	is_valid_url: function(str) {
		return !!/^(?:(?:https?|ftp):\/\/)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/\S*)?$/i.test(str);
	},

	escape_regex: function(string) {
		return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
	},

	text_to_lines: function(text) {
		return text.split(/\r\n|\n/g);
	},

	str_to_js: function(str) {
		try { return JSON.parse(str); } catch (e) { }
		return str;
	},

	capitalize: function(str) {
		return str.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
	},
	
	is_numeric: function(n) {
		return !isNaN(parseFloat(n)) && isFinite(n);
	},

	debounce: function(func, wait, immediate) {
		var timeout;
		return function() {
			var context = this, args = arguments;
			var later = function() {
				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	},
	
	almost_equal: function(a,b,epsilon=FLT_EPSILON) {
		var d = Math.abs(a-b);
		return d <= epsilon;
	},

	remove_nulls: function(obj) {
		if (Array.isArray(obj)) {
			var i = obj.length;
			while (i--) {
				if (obj[i] == null) obj.splice(i, 1);
			}
		} else {
			for (var k of Object.keys(obj)) {
				if (obj[k] == null) delete obj[k];
			}
		}
	},

    is_path_remote: function(path_str) {
        return (path_str || "").includes("://");
    },

    is_ip_local: function(ip) {
        return ip === "127.0.0.1" || ip === "::1" || ip == "::ffff:127.0.0.1"
    },

    date_to_string: function(date){
        if (!date) date = new Date();
        return `${date.getUTCFullYear()}${date.getUTCMonth()}${date.getUTCDate()}${date.getUTCHours()}${date.getUTCMinutes()}${date.getUTCSeconds()}${date.getUTCMilliseconds()}`;
    },

    split_path: function(path) {
        return path.replace(/^(?:[\/\\]+|[^\/\\]+?\:\/\/)/, "").split(/[\/\\]+/);
    },

    /* register_change(obj, name) {
        return (key,value) => {
            // if key is int, value an array element.
            if (typeof key === "number") {
                if (!obj[name]) obj[name] = [];
                obj[name].push(value);
            } else {
                if (!obj[name]) obj[name] = {};
                obj[name][key] = value;
            }
        }
    }, */

    is_plain_object: function(obj) {
        return	typeof obj === 'object' && obj !== null && obj.constructor === Object && Object.prototype.toString.call(obj) === '[object Object]';
    },

    websocket_ready: function(ws){
        var is_open = ws ? ws.readyState === 1 : false
        if (is_open) return Promise.resolve();
        return new Promise(resolve=>{
            ws.on("open", ()=>resolve());
        });
    },

    /* once: function(event_emitter, event){
        return new Promise(resolve=>{
            event_emitter.once(event, (...args)=>{
                resolve(...args);
            })
        })
    }, */

    deepcopy: function(obj) {
        return JSON.parse(JSON.stringify(obj));
    },
    
    zip: function(keys, values) {
        return keys.reduce(
            (obj, key, i)=>{
                obj[key] = values[i];
                return obj;
            }, {}
        );
    },

    promise_all_object(obj) {
        return Promise.all(Object.keys(obj).map((key)=>Promise.resolve(obj[key]).then((val)=>({key:key,val:val})))).then((items)=>{
            return items.reduce(
                (obj, item, i)=>{
                    obj[item.key] = item.val;
                    return obj;
                }, {}
            );
        });
    },

    replace_all: function(str, search, replace) {
        return str.split(search).join(replace);
    },
    
    set_maximum_interval: function(callback, interval, ...args) {
        var orig_timeout;
        async function _set_maximum_interval(callback, interval, ...args) {
            const t = +new Date();
            await callback.call(...args);
            if (maximum_interval_timeouts.get(orig_timeout)) {
                maximum_interval_timeouts.set(orig_timeout, setTimeout(_set_maximum_interval, Math.max(0, interval - new Date() + t), callback, interval, ...args));
            }
        }
        orig_timeout = setTimeout(_set_maximum_interval, interval, callback, interval, ...args);
        maximum_interval_timeouts.set(orig_timeout, orig_timeout);
        return orig_timeout;
    },
    
    clear_maximum_interval: function(timeout) {
        clearTimeout(maximum_interval_timeouts.get(timeout));
        maximum_interval_timeouts.delete(timeout);
    },
    
    shuffle: function(arra1) {
        var ctr = arra1.length, temp, index;
        while (ctr > 0) {
            index = Math.floor(Math.random() * ctr);
            ctr--;
            temp = arra1[ctr];
            arra1[ctr] = arra1[index];
            arra1[index] = temp;
        }
        return arra1;
    },
    
    matchAll: function(s, re) {
        var matches = [], m = null;
        while (m = re.exec(s)) {
            matches.push(m);
        }
        return matches;
    },
    
    promise_timeout: function(promise, ms=10000) {
        var id;
        var timeout = new Promise((resolve, reject) => {
            id = setTimeout(() => {
                clearTimeout(id);
                reject('Timed out in '+ ms + 'ms.')
            }, ms);
        });
        // Returns a race between our timeout and the passed in promise
        return Promise.race([promise,timeout]).then((d)=>{
            clearTimeout(id);
            return d;
        });
    },
    
    promise_min_wait: function(promise, ms=10000) {
        return Promise.all([promise,utils.timeout(ms)]).then((d)=>{
            return d[0];
        });
    },
    
    timeout: function(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    split_string(str, partLength) {
        var list = [];
        if (str !== "" && partLength > 0) {
            for (var i = 0; i < str.length; i += partLength) {
                list.push(str.substr(i, Math.min(partLength, str.length)));
            }
        }
        return list;
    },
    
    array_move_before: function(arr, from, to) {
        if (to > from) to--;
        if (from === to) return arr;
        return utils.array_move(arr, from, to);
    },

    array_move: function(arr, from, to) {
        from = utils.clamp(from, 0, arr.length-1);
        to = utils.clamp(to, 0, arr.length-1);
        arr.splice(to, 0, ...arr.splice(from, 1));
        return arr;
    },
    
    time_str_to_seconds: function(str, format="hh:mm:ss") {
        return utils.time_str_to_ms(str, format) / 1000;
    },
    
    time_str_to_ms: function(str, format="hh:mm:ss") {
        var parts = String(str).split(":");
        var format_parts = format.split(":");
        if (format_parts.length > parts.length) format_parts = format_parts.slice(-parts.length); // so if str = "10:00" and format = "hh:mm:ss", the assumed format will be "mm:ss"
        else if (format_parts.length < parts.length) parts = parts.slice(-format_parts.length);
        var ms = 0
        for (var i = 0; i < parts.length; i++) {
            var v = parseFloat(parts[i]) || 0;
            if (format_parts[i].startsWith("d")) ms += v * 24 * 60 * 60 * 1000;
            if (format_parts[i].startsWith("h")) ms += v * 60 * 60 * 1000;
            else if (format_parts[i].startsWith("m")) ms += v * 60 * 1000;
            else if (format_parts[i].startsWith("s")) ms += v * 1000;
        }
        return ms;
    },

    // ms
	time_to_str: function(num, format="hh:mm:ss") {
		num = Math.abs(+num) || 0;
        var format_parts = format.split(/[^a-z]/i);
        // var separators = format.replace(/[a-z]/gi, "").split("");
        // console.log(separators)
        var parts = [];
        var ms_length = 0;
        for (var i = 0; i < format_parts.length; i++) {
            var p = format_parts[i];
            var divider = 1;
            if (p.startsWith("d")) divider = 24 * 60 * 60 * 1000;
            else if (p.startsWith("h")) divider = 60 * 60 * 1000;
            else if (p.startsWith("m")) divider = 60 * 1000;
            else if (p.startsWith("s")) divider = 1000;
            else if (p.startsWith("S")) {
                ms_length = p.length;
                continue;
            }
            var v = (i < format_parts.length-1) ? Math.floor(num / divider) : Math.round(num / divider);
            parts.push(v.toString().padStart(p.length,"0"));
            // if (separators[i]) parts.push(separators[i])
            num -= v * divider;
        }
        if (num < 0) num = 0;
        var output = parts.join(":");
        if (ms_length) {
            var e = Math.pow(10, ms_length);
            output += "." + (num/1000).toFixed(ms_length).slice(2);
        }
		return output;
	},
    
    array_remove: function(arr, item) {
        var index = arr.indexOf(item);
        if (index === -1) return false;
        arr.splice(index, 1);
        return true;
    },
    
    array_unique: function(arr) {
        return arr.filter((v,i,a)=>a.indexOf(v)==i);
    },
    
    random_string: function(length, chars="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        var result = '';
        for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
        return result;
    },
    
    is_empty: function(obj) {
        if (typeof obj !== "object") return false;
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) return false;
        }
        return true;
    },
    
    filter_object: function(raw, cb) {
        return Object.keys(raw)
            .filter(cb)
            .reduce((obj, key) => {
                obj[key] = raw[key];
                return obj;
            }, {});
    },

    arrays_equal: function(arr1, arr2) {
        var length = arr1.length;
        if (length !== arr2.length) return false;
        for (var i = 0; i < length; i++) {
            if (arr1[i] !== arr2[i]) return false;
        }
        return true;
    },
    
    get: function(cb, default_value) {
        try { return cb(); } catch { return default_value; }
    },
    
    av_escape: function(url){
        return url.replace(/\\:/g, "\\\\:");
    },
    
    clear: function(obj) {
        if (Array.isArray(obj)) {
            obj.splice(0,obj.length);
        } else {
            for (var k of Object.keys(obj)){
                delete obj[k];
            }
        }
    },
    
    clamp: function(value, min, max) {
        return Math.min(Math.max(value, min), max);
    },
    
    loop: function(value, length) {
        return (length + value) % length;
    },

    sort(arr, ...cbs) {
        return arr.sort((a,b)=>{
            for (var cb of cbs) {
                var av = cb(a), bv = cb(b);
                if (!Array.isArray(av)) av = [av, "ASCENDING"];
                if (!Array.isArray(bv)) bv = [bv, "ASCENDING"];
                var m = 1;
                if (av[1] === "ASCENDING") m = 1;
                else if (av[1] === "DESCENDING") m = -1;
                else throw new Error();
                if (av[0] < bv[0]) return -1 * m;
                if (av[0] > bv[0]) return 1 * m;
            }
            return 0;
        });
    },

    num_to_str: function(num, decimals=3) {
        return num.toLocaleString({
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

};

if (typeof module !== 'undefined' && module.exports) module.exports = utils;
else if (typeof window !== 'undefined') window.utils = utils;