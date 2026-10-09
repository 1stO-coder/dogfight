/**
 * Universal Flight Joystick & Gamepad Input Manager for Sky Ace: Dogfight Arena
 *
 * Supports ALL Joystick & Gamepad Brands:
 * - Logitech (Extreme 3D Pro, Attack 3, F310, F710)
 * - Thrustmaster (T.Flight HOTAS X/One/4, T.16000M, TCA Airbus/Boeing, Warthog)
 * - VKB, Virpil, WinWing
 * - Xbox Series / One / 360 controllers
 * - PlayStation DualSense / DualShock 4
 * - Generic USB PC Flight Sticks / Gamepads / OEM flight yokes
 *
 * Adheres strictly to authentic aircraft flight controls:
 * - PULL STICK BACK / S = PITCH UP (Climb)
 * - PUSH STICK FORWARD / W = PITCH DOWN (Dive)
 * - STICK LEFT / A = BANK LEFT (Roll Left & Turn)
 * - STICK RIGHT / D = BANK RIGHT (Roll Right & Turn)
 * - THROTTLE: Up / Down arrow or Shift / Ctrl or Gamepad Slider
 * - FIRE: Universal Trigger detection (Button 0, 1, 2, 5, 7, 8, 11, analog triggers, space, left click)
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

    // Last pressed button for live testing feedback
    this.lastPressedButton = null;

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
    this.gamepadIndex = null;
    this.connectedGamepad = null;
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
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (gp && gp.connected) {
        return {
          connected: true,
          name: gp.id,
          axes: gp.axes.length,
          buttons: gp.buttons.length,
          index: gp.index
        };
      }
    }
    return { connected: false, name: 'Keyboard / Mouse Mode' };
  }

  poll() {
    let rawPitch = 0; // -1 = dive, +1 = climb
    let rawRoll = 0;  // -1 = bank left, +1 = bank right
    let triggerPressed = false;
    let throttleDelta = 0;

    // Scan all connected gamepads (supports any USB/Bluetooth device index)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let activePad = null;

    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (gp && gp.connected) {
        activePad = gp;
        this.gamepadIndex = gp.index;
        this.connectedGamepad = gp;
        break;
      }
    }

    if (activePad) {
      const gp = activePad;

      // 1. Primary Flight Axes (Pitch & Roll)
      // Standard: Axis 1 = Pitch (Y), Axis 0 = Roll (X)
      const stickY = gp.axes.length > 1 ? gp.axes[1] : 0;
      const stickX = gp.axes.length > 0 ? gp.axes[0] : 0;

      // Y-axis down = positive -> pull back = Pitch Up (climb)
      rawPitch = this.applyDeadzone(stickY);
      rawRoll = this.applyDeadzone(stickX);

      // 2. Throttle Axis (Check axis 2, 3, or slider axes)
      if (gp.axes.length > 2) {
        // Many HOTAS controllers use Axis 2 or Axis 3 for throttle slider
        const thAxis = gp.axes[2];
        if (Math.abs(thAxis) > 0.15) {
          throttleDelta = -thAxis;
        }
      }

      // 3. Universal Fire Trigger Detection for ALL Brands:
      // Logitech Extreme 3D: Trigger is Button 0, Thumb is Button 1
      // Thrustmaster HOTAS: Trigger is Button 0 or Button 1
      // Xbox: A (0), B (1), RB (5), RT (7)
      // PlayStation: Cross (0), Circle (1), R1 (5), R2 (7)
      // Generic Chinese USB Flight Sticks: Trigger is often Button 1, 2, or 8!
      const fireButtonIndices = [0, 1, 2, 3, 5, 7, 8, 11];

      for (let idx of fireButtonIndices) {
        if (idx < gp.buttons.length) {
          const btn = gp.buttons[idx];
          // Check both digital .pressed AND analog pressure .value > 0.25
          if (btn && (btn.pressed || btn.value > 0.25)) {
            triggerPressed = true;
            this.lastPressedButton = `Button ${idx}`;
            break;
          }
        }
      }

      // Also track any other button currently pressed for tester feedback
      for (let bIdx = 0; bIdx < gp.buttons.length; bIdx++) {
        const b = gp.buttons[bIdx];
        if (b && (b.pressed || b.value > 0.25)) {
          this.lastPressedButton = `Button ${bIdx}`;
          // If any top face button is held on a flight stick, count as fire trigger
          if (bIdx < 12) {
            triggerPressed = true;
          }
          break;
        }
      }
    }

    // Keyboard Fallbacks
    if (this.keys.S) rawPitch = 1.0;   // S = Pull back -> Pitch Up
    if (this.keys.W) rawPitch = -1.0;  // W = Push forward -> Pitch Down
    if (this.keys.D) rawRoll = 1.0;    // D = Bank Right
    if (this.keys.A) rawRoll = -1.0;   // A = Bank Left

    if (this.keys.ArrowUp || this.keys.Shift) throttleDelta += 1.0;
    if (this.keys.ArrowDown || this.keys.Control) throttleDelta -= 1.0;

    if (this.keys.Space || this.isMouseDown) {
      triggerPressed = true;
      this.lastPressedButton = this.keys.Space ? 'Spacebar' : 'Mouse Left';
    }

    // Apply pitch/roll inversions
    const pitch = this.invertPitch ? -rawPitch : rawPitch;
    const roll = this.invertRoll ? -rawRoll : rawRoll;

    // Smooth throttle update (0.70 to 1.45)
    if (throttleDelta > 0) {
      this.throttle = Math.min(1.45, this.throttle + 0.35 * 0.016);
    } else if (throttleDelta < 0) {
      this.throttle = Math.max(0.70, this.throttle - 0.35 * 0.016);
    }

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
      lastPressedButton: this.lastPressedButton,
    };
  }
}

window.DogfightJoystick = new DogfightJoystickManager();
