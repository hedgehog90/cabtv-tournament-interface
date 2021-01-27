class DynamicNormalizationProcessor extends AudioWorkletProcessor {
    buffer = [];
    gain = 1.0;
    static get parameterDescriptors() {
        return [
            {
                name: "volume",
                defaultValue: 1.0,
                minValue: 0.0,
                maxValue: 10.0
            },
            {
                name: "wet",
                defaultValue: 1.0,
                minValue: 0.0,
                maxValue: 1.0
            },
            {
                name: "dry",
                defaultValue: 0.0,
                minValue: 0.0,
                maxValue: 1.0
            },
            {
                name: "ease",
                defaultValue: 0.1,
                minValue: 0.01,
                maxValue: 1.0
            },
            {
                name: "targetrms",
                defaultValue: 0.9,
                minValue: 0.0,
                maxValue: 1.0
            },
            {
                name: "maxgain",
                defaultValue: 10.0,
                minValue: 1.0,
                maxValue: 100.0
            },
            {
                name: "framelen",
                defaultValue: 3000,
                minValue: 10,
                maxValue: 8000
            }
        ];
    }
    process(inputs, outputs, params) {
        const input = inputs[0];
        const output = outputs[0];
        var max_rms = 0;
        for (let c = 0; c < input.length; c++) {
            for (let i = 0; i < input[c].length; i++) {
                var v = Math.abs(input[c][i]);
                if (v > max_rms) max_rms = v;
            }
        }
        // for (var i = 0 ; i < 7000000; i++) Math.sqrt(i);

        var sample_duration = input[0].length / sampleRate * 1000; // in ms
        var n = params.framelen[0] / sample_duration; // num samples per frame
        this.buffer.push(max_rms);
        this.buffer.splice(0, this.buffer.length - n);
        
        var avg_rms = this.buffer.reduce((a,b)=>a+b) / n;
        var gain = Math.min((params.targetrms[0]/2) / avg_rms, params.maxgain[0]);

        this.gain += (gain - this.gain) * params.ease[0];

        // if (max_rms * this.gain > params.targetrms[0]/2) this.gain = 1.0;
        if (max_rms * this.gain > params.targetrms[0]/2) this.gain = params.targetrms[0]/2 / max_rms;
        
        for (let c = 0; c < input.length; c++) {
            for (let i = 0; i < input[c].length; i++) {
                output[c][i] = (input[c][i] * this.gain * params.wet[0] + input[c][i] * params.dry[0]) * params.volume[0];
            }
        }
        return true;
    }
}
registerProcessor("dynamic-normalization-processor", DynamicNormalizationProcessor);

/* class VolumeProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: "volume",
                defaultValue: 1.0,
                minValue: 0.00,
                maxValue: 1.00
            },
        ];
    }
    process(inputs, outputs, params) {
        const input = inputs[0];
        const output = outputs[0];
        var v = params.volume[0];
        for (let c = 0; c < input.length; c++) {
            for (let i = 0; i < input[c].length; i++) {
                output[c][i] = input[c][i] * v;
            }
        }
        return true;
    }
}
registerProcessor("volume-processor", VolumeProcessor); */

/* class GetRMSProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, params) {
        const input = inputs[0];
        // var output = input.map(c=>Math.max(...c));
        var output = input.map(samples=>{
            var total = 0;
            for (var s of samples) total += Math.abs(s);
            total /= samples.length;
            return total;
        });
        this.port.postMessage(output);
        return true;
    }
}
registerProcessor("get-rms-processor", GetRMSProcessor); */