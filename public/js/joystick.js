/**
 * Flight Joystick & Gamepad Input Manager for Sky Ace: Dogfight Arena
 *
 * Adheres strictly to authentic aircraft flight controls:
 * - PULL STICK BACK / S = PITCH UP (Climb)
 * - PUSH STICK FORWARD / W = PITCH DOWN (Dive)
 * - STICK LEFT / A = BANK LEFT (Roll Left & Turn)
 * - STICK RIGHT / D = BANK RIGHT (Roll Right & Turn)
 * - THROTTLE: Up / Down arrow or Shift / Ctrl or Gamepad Slider
 * - FIRE: Trigger Button (0), RT (7), RB (5), Spacebar, Left Mouse Click
 */
class DogfightJoystickManager {
  constructor() {
    this.gamepadIndex = null;
    this.connectedGamepad = null;
    this.deadzone = 0.08;
    this.invertPitch = false;
    this.invertRoll = false;

    // Throttle state
    this.throttle = 1.0; // 0.65 (idle) to 1.45 (afterburner)

    // Keyboard states
    this.keys = {
      W: false,
      S: false,
      A: false,
      D: false,
      ArrowUp: false,
      ArrowDown: false,
      Shift: false,
      Control: false,
      Space: false,
      Tab: false,
    };

    this.isMouseDown = false;
    this.lastTriggerState = false;

    // Listeners for Gamepad connection
    window.addEventListener('gamepadconnected', (e) => this.onGamepadConnected(e));
    window.addEventListener('gamepaddisconnected', (e) => this.onGamepadDisconnected(e));

    // Keyboard listeners
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Mouse fire listeners
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        this.isMouseDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    });

    this.callbacks = {
      onFire: null,
      onConnectionChange: null,
    };
  }

  onGamepadConnected(e) {
    this.gamepadIndex = e.gamepad.index;
    this.connectedGamepad = e.gamepad;
    console.log(`[Joystick] Connected: ${e.gamepad.id} at index ${e.gamepad.index}`);
    if (this.callbacks.onConnectionChange) {
      this.callbacks.onConnectionChange(this.getDeviceInfo());
    }
  }

  onGamepadDisconnected(e) {
    console.log(`[Joystick] Disconnected: index ${e.gamepad.index}`);
    if (this.gamepadIndex === e.gamepad.index) {
      this.gamepadIndex = null;
      this.connectedGamepad = null;
    }
    if (this.callbacks.onConnectionChange) {
      this.callbacks.onConnectionChange(this.getDeviceInfo());
    }
  }

  onKeyDown(e) {
    const k = e.key;
    if (k === 'w' || k === 'W') this.keys.W = true;
    if (k === 's' || k === 'S') this.keys.S = true;
    if (k === 'a' || k === 'A') this.keys.A = true;
    if (k === 'd' || k === 'D') this.keys.D = true;
    if (k === 'ArrowUp') this.keys.ArrowUp = true;
    if (k === 'ArrowDown') this.keys.ArrowDown = true;
    if (k === 'Shift') this.keys.Shift = true;
    if (k === 'Control') this.keys.Control = true;
    if (k === ' ' || e.code === 'Space') {
      this.keys.Space = true;
      e.preventDefault();
    }
    if (k === 'Tab') {
      this.keys.Tab = true;
      e.preventDefault();
    }
  }

  onKeyUp(e) {
    const k = e.key;
    if (k === 'w' || k === 'W') this.keys.W = false;
    if (k === 's' || k === 'S') this.keys.S = false;
    if (k === 'a' || k === 'A') this.keys.A = false;
    if (k === 'd' || k === 'D') this.keys.D = false;
    if (k === 'ArrowUp') this.keys.ArrowUp = false;
    if (k === 'ArrowDown') this.keys.ArrowDown = false;
    if (k === 'Shift') this.keys.Shift = false;
    if (k === 'Control') this.keys.Control = false;
    if (k === ' ' || e.code === 'Space') this.keys.Space = false;
    if (k === 'Tab') this.keys.Tab = false;
  }

  applyDeadzone(val) {
    if (Math.abs(val) < this.deadzone) return 0;
    const sign = Math.sign(val);
    return sign * ((Math.abs(val) - this.deadzone) / (1 - this.deadzone));
  }

  getDeviceInfo() {
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads ? navigator.getGamepads()[this.gamepadIndex] : null;
      if (gp) {
        return { connected: true, name: gp.id, axes: gp.axes.length, buttons: gp.buttons.length };
      }
    }
    return { connected: false, name: 'Keyboard / Mouse Mode' };
  }

  poll() {
    let rawPitch = 0; // -1 = dive, +1 = climb
    let rawRoll = 0;  // -1 = bank left, +1 = bank right
    let triggerPressed = false;
    let throttleDelta = 0;

    // Check physical gamepad
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads ? navigator.getGamepads()[this.gamepadIndex] : null;
      if (gp) {
        // Y-axis: standard joystick down = positive -> pull back = Pitch Up
        // Up = negative -> push forward = Pitch Down
        const stickY = gp.axes.length > 1 ? gp.axes[1] : 0;
        const stickX = gp.axes.length > 0 ? gp.axes[0] : 0;

        rawPitch = this.applyDeadzone(stickY); // Down = positive (climb)
        rawRoll = this.applyDeadzone(stickX);  // Right = positive (bank right)

        // Throttle axis (if present on axis 2 or axis 3 or triggers)
        if (gp.axes.length > 2) {
          const throttleAxis = gp.axes[2];
          if (Math.abs(throttleAxis) > 0.1) {
            throttleDelta = -throttleAxis;
          }
        }

        // Fire triggers: Button 0 (Trigger), Button 7 (RT), Button 5 (RB)
        const b0 = gp.buttons[0] && gp.buttons[0].pressed;
        const b7 = gp.buttons[7] && gp.buttons[7].pressed;
        const b5 = gp.buttons[5] && gp.buttons[5].pressed;
        triggerPressed = b0 || b7 || b5;
      }
    }

    // Keyboard controls
    if (this.keys.S) rawPitch = 1.0;   // S = Pull back -> Pitch Up
    if (this.keys.W) rawPitch = -1.0;  // W = Push forward -> Pitch Down
    if (this.keys.D) rawRoll = 1.0;    // D = Bank Right
    if (this.keys.A) rawRoll = -1.0;   // A = Bank Left

    if (this.keys.ArrowUp || this.keys.Shift) throttleDelta += 1.0;
    if (this.keys.ArrowDown || this.keys.Control) throttleDelta -= 1.0;

    if (this.keys.Space || this.isMouseDown) {
      triggerPressed = true;
    }

    // Apply inversion
    const pitch = this.invertPitch ? -rawPitch : rawPitch;
    const roll = this.invertRoll ? -rawRoll : rawRoll;

    // Update throttle smoothly (0.75 to 1.45)
    if (throttleDelta > 0) {
      this.throttle = Math.min(1.45, this.throttle + 0.35 * 0.016);
    } else if (throttleDelta < 0) {
      this.throttle = Math.max(0.70, this.throttle - 0.35 * 0.016);
    }

    // Continuous fire trigger callback
    if (triggerPressed && this.callbacks.onFire) {
      this.callbacks.onFire();
    }
    this.lastTriggerState = triggerPressed;

    return {
      pitch: pitch,
      roll: roll,
      throttle: this.throttle,
      isFiring: triggerPressed,
      showScoreboard: this.keys.Tab,
    };
  }
}

window.DogfightJoystick = new DogfightJoystickManager();
