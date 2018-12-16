const play = require('audio-play');
const load = require('audio-loader');

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-securitysystem', 'Security system', SecuritySystem);
}

function SecuritySystem(log, config) {
  this.log = log;
  this.name = config['name'];
  this.armSeconds = config['arm_seconds'];
  this.triggerSeconds = config['trigger_seconds'];

  // Check for optional options
  if (this.armSeconds === undefined) {
    this.armSeconds = 0;
  }

  if (this.triggerSeconds === undefined) {
    this.triggerSeconds = 0;
  }

  // Variables
  this.triggerTimeout = null;

  // Security system
  this.service = new Service.SecuritySystem(this.name);

  this.service
    .getCharacteristic(Characteristic.SecuritySystemTargetState)
    .on('get', this.getTargetState.bind(this))
    .on('set', this.setTargetState.bind(this));

  this.service
    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
    .on('get', this.getCurrentState.bind(this));

  this.currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
  this.targetState = Characteristic.SecuritySystemCurrentState.DISARMED;

  // Switch
  this.switchService = new Service.Switch('Siren');

  this.switchService
    .getCharacteristic(Characteristic.On)
    .on('get', this.getSwitchState.bind(this))
    .on('set', this.setSwitchState.bind(this));

  this.on = false;

  // Sounds
  var securitySystem = this;

  this.sirenSoundBuffer = null;
  this.sirenSoundPlayback = null;

  var loadSirenSound = function() {
    var promise = load(__dirname + '/sounds/siren.mp3').then(function(buffer) {
      securitySystem.sirenSoundBuffer = buffer;
    });

    return promise;
  };

  this.armedSoundBuffer = null;

  var loadArmedSound = function() {
    var promise = load(__dirname + '/sounds/armed.mp3').then(function(buffer) {
      securitySystem.armedSoundBuffer = buffer;
    });

    return promise;
  };

  this.disarmedSoundBuffer = null;

  var loadDisarmedSound = function() {
    var promise = load(__dirname + '/sounds/disarmed.mp3').then(function(buffer) {
      securitySystem.disarmedSoundBuffer = buffer;
    });

    return promise;
  };

  var soundsLoaded = function() {
    securitySystem.log('Sounds loaded.');
  };

  var soundsError = function() {
    securitySystem.log('Error loading sounds.');
  };

  loadSirenSound()
    .then(loadArmedSound)
    .then(loadDisarmedSound)
    .then(soundsLoaded)
    .catch(soundsError);
}

// Security system
SecuritySystem.prototype.stopSirenSound = function() {
  if (this.sirenSoundPlayback !== null) {
    this.sirenSoundPlayback.pause();
  }
}

SecuritySystem.prototype.getCurrentState = function(callback) {
  callback(null, this.currentState);
}

SecuritySystem.prototype.updateCurrentState = function(state) {
  this.currentState = state;
  this.service.setCharacteristic(Characteristic.SecuritySystemCurrentState, state);
  this.logState('Current', state);

  if (state === Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
    this.sirenSoundPlayback = play(this.sirenSoundBuffer, {
      'loop': true
    });
  }
  else if (state === Characteristic.SecuritySystemCurrentState.DISARMED) {
    play(this.disarmedSoundBuffer);
  }
  else {
    play(this.armedSoundBuffer);
  }
}

SecuritySystem.prototype.logState = function(type, state) {
  switch (state) {
    case Characteristic.SecuritySystemCurrentState.STAY_ARM:
      this.log(type + ' state (Home)');
      break;

    case Characteristic.SecuritySystemCurrentState.AWAY_ARM:
      this.log(type + ' state (Away)');
      break;

    case Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
      this.log(type + ' state (Night)');
      break;

    case Characteristic.SecuritySystemCurrentState.DISARMED:
      this.log(type + ' state (Off)');
      break;

    case Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED:
      this.log(type + ' state (Alarm triggered)');
      break;

    default:
      this.log(type + ' state (Unknown state)');
  }
}

SecuritySystem.prototype.getTargetState = function(callback) {
  callback(null, this.targetState);
}

SecuritySystem.prototype.setTargetState = function(state, callback) {
  this.targetState = state;
  this.logState('Target', state);

  // Check if alarm is about to be
  // triggered and cancel it if
  // user is changing to other mode
  if (this.triggerTimeout !== null && state !== Characteristic.SecuritySystemTargetState.ALARM_TRIGGERED) {
    clearTimeout(this.triggerTimeout);

    this.triggerTimeout = null;
    this.log('Trigger timeout (Cancelled)');

    // Turn off 'Siren' accessory
    if (this.on) {
      this.on = false;
      this.switchService.setCharacteristic(Characteristic.On, this.on);
    }
  }

  // Check if alarm is already triggered
  if (this.currentState === Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
    // Cancel it if needed
    if (state !== Characteristic.SecuritySystemTargetState.ALARM_TRIGGERED) {
      this.stopSirenSound();

      // Turn off 'Siren' accessory
      if (this.on) {
        this.on = false;
        this.switchService.setCharacteristic(Characteristic.On, this.on);
      }
    }
  }

  // Update current state
  var armSeconds = 0;

  // No delay needed to disarm the security system
  if (state !== Characteristic.SecuritySystemCurrentState.DISARMED) {
    armSeconds = this.armSeconds;
  }

  setTimeout(function() {
    this.updateCurrentState(state);
    callback(null);
  }.bind(this), armSeconds * 1000);
}

// Switch
SecuritySystem.prototype.getSwitchState = function(callback) {
  callback(null, this.on);
}

SecuritySystem.prototype.setSwitchState = function(state, callback) {
  this.on = state;

  // Check state
  if (state && this.currentState !== Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
    this.log('Trigger timeout (Started)');

    this.triggerTimeout = setTimeout(function() {
      this.updateCurrentState(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
      this.triggerTimeout = null;
    }.bind(this), this.triggerSeconds * 1000);
  }
  else if (this.currentState === Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
    this.stopSirenSound();
    this.service.setCharacteristic(Characteristic.SecuritySystemTargetState, Characteristic.SecuritySystemCurrentState.DISARMED);
  }

  callback(null);
}

SecuritySystem.prototype.getServices = function() {
  return [
    this.service,
    this.switchService
  ];
}
