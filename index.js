module.exports = init

var async = require('async')
  , Hue = require('node-hue-api')
  , HueApi = Hue.HueApi
  , lightState = Hue.lightState

function init(callback) {
  callback(null, 'hue', PhilipsHue)
}

function PhilipsHue(automait, logger, config) {
  this.automait = automait
  this.logger = logger
  this.config = config
  this.groups = config.groups
  this.api = new HueApi(config.bridgeIp, config.username)
}

PhilipsHue.prototype.areAnyLightsOn = function (groupName, callback) {
  areLightsOn.call(this, 'someLimit', groupName, callback)
}

PhilipsHue.prototype.areAllLightsOn = function (groupName, callback) {
  areLightsOn.call(this, 'everyLimit', groupName, callback)
}

function areLightsOn(fnName, groupName, callback) {
  if (!fnName || !async[fnName]) throw new Error('fnName must be valid')
  var lights = this.groups[groupName]
  if (!lights) return callback(new Error('No light group with name:' + groupName))

  var lightStatusError = false
  async[fnName](lights
  , 1
  , function (lightId, eachCb) {
      this.api.lightStatus(lightId, function (error, response) {
        if (error) {
          lightStatusError = error
          return eachCb()
        }
        eachCb(response.state && response.state.on)
      })
    }.bind(this)
  , function (isOn) {
      if (lightStatusError) return callback(lightStatusError)
      callback(null, isOn)
    }
  )
}

PhilipsHue.prototype.setState = function (groupName, powerState, brightness, color, callback) {
  var lights = this.groups[groupName]
  if (!lights) return callback(new Error('No light group with name:' + groupName))

  var colorMapping = { 'cool-white': 1, 'warm-white': 300 }

  var state = lightState.create()
  if (powerState) {
    state.on()
    var mappedColor = colorMapping[ color ]
    if (color && mappedColor) {
      state.white(mappedColor, brightness)
    } else if (color) {
      state.rgb(color)
    }
    if (brightness) {
      state.brightness(brightness)
    }
  } else {
    state.off()
  }

  async.each(lights
  , function (lightId, eachCb) {
      this.api.setLightState(lightId, state, eachCb)
    }.bind(this)
  , callback
  )
}

PhilipsHue.prototype.flashColour = function (groupName, color, callback) {
  var lights = this.groups[groupName]
  if (!lights) return callback(new Error('No light group with name:' + groupName))

  var originalStates = {}
    , alertState = lightState.create().on().brightness(100).rgb(color).shortAlert()

  function getOriginalStates(cb) {
    async.eachSeries(lights
    , function (lightId, eachCb) {
        this.api.lightStatus(lightId, function (error, response) {
          if (error) return cb(error)
          var state = response.state
          state.alert = 'none'
          originalStates[lightId] = state
          eachCb()
        })
      }.bind(this)
    , cb
    )
  }

  function setAlertStates(cb) {
    async.eachLimit(lights
    , 4
    , function (lightId, eachCb) {
        this.api.setLightState(lightId, alertState, eachCb)
      }.bind(this)
    , cb
    )
  }

  function setOriginalStates(cb) {
    async.eachLimit(lights
    , 4
    , function (lightId, eachCb) {
        var state = originalStates[lightId]
        this.api.setLightState(lightId, state, eachCb)
      }.bind(this)
    , cb
    )
  }

  var tasks =
    [ getOriginalStates.bind(this)
    , setAlertStates.bind(this)
    ]

  async.series(tasks, function (error) {
    if (error) return callback(error)
    setTimeout(setOriginalStates.bind(this, callback), 1500)
  }.bind(this))
}
