var props = 0;

class Button extends HTMLButtonElement {
    constructor(label, onclick = null) {
        super();
        this.type = "button";
        this.textContent = label;
        this.onclick = onclick;
    }
}
window.customElements.define('ui-button', Button, {extends:'button'});

class Property extends HTMLElement {
    _orientation;
    set orientation(value) { this._orientation = value; this.setAttribute("data-orientation", value) }
    get orientation() { return this._orientation; }

    constructor(label, html) {
        super();
        this.orientation = Horizontal;
        var name = `prop_${props++}`;
        if (label) {
            var label_element = $(`<label>${label}</label>`)[0];
            label_element.setAttribute("for", name);
            this.append(label_element);
        }
        this._input = $(html)[0];
        this._input.setAttribute("name", name);
        this.append(this._input);
    }

    get value() {
        if (this._input.nodeName === "input" && this._input.type === "checkbox") {
            return this._input.checked;
        }
        try {
            return JSON.parse(this._input.value);
        } catch {
            return this._input.value;
        }
    }

    set value(value) {
        this.set_value(value, false)
    }

    set_value(value, trigger_change=true) {
        if (this.value === value) return;
        if (this._input.nodeName === "input" && this._input.type === "checkbox") {
            this._input.checked = value;
        } else {
            this._input.value = value;
        }
        this.dispatchEvent(new Event("update"));
        if (trigger_change) this.dispatchEvent(new Event("change"));
    }
}
window.customElements.define('ui-property', Property);

class PropertyGroup extends HTMLElement {
    _container;
    constructor(label) {
        super();
        if (label) this.append($(`<h5>${label}</h5>`)[0]);
        this._container = document.createElement("div");
        this.append(this._container);
    }
}
window.customElements.define('ui-property-group', PropertyGroup);

const Vertical = "vertical";
const Horizontal = "horizontal";

module.exports = { Button, Property, PropertyGroup, Horizontal, Vertical };