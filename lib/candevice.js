/**
 * Copyright 2018 Scott Bender (scott@scottbender.net) and Jouni Hartikainen (jouni.hartikainen@iki.fi)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('canboatjs:candevice')
const EventEmitter = require('events')
const _ = require('lodash')

class CanDevice extends EventEmitter {
  constructor (canbus, options) {
    super()

    this.canbus = canbus
    this.options = _.isUndefined(options) ? {} : options

    this.address = options.preferedAddress || 100
    
    this.handlers = {
      "59904": this.handleISORequest,
      "126208": this.handleGroupFunction,
      "60928": this.handleISOAddressClaim
    }

    //this.options.app.on('N2KAnalyzerOut', (pgn) => {
    //  this.n2kMessage(pgn)
    //});

    sendAddressClaim(this)
  }
   
  n2kMessage(pgn) {
    if ( pgn.dst == 255 || pgn.dst == this.address ) {
      if ( pgn.pgn == 59904 ) {
        handleISORequest(this, pgn)
      } else if ( pgn.pgn == 126208 ) {
        handleGroupFunction(this, pgn)
      } else if ( pgn.pgn == 60928 ) {
        handleISOAddressClaim(this, pgn)
      }

      /*
      var handler = this.handlers[pgn.pgn.toString()]
      if ( pgn.dst == this.address )
        debug(`handler ${handler}`)
      if ( _.isFunction(handler) ) {
        debug(`got handled PGN ${JSON.stringify(pgn)} ${handled}`)
        handler(pgn)
      }
      */
    }
  }
}

function sendPGN(device, pgn) {
  pgn.src = device.address
  debug(`Sending PGN ${JSON.stringify(pgn)}`)
  device.canbus.sendPGN(pgn)
}

function handleISORequest(device, n2kMsg) {
  debug(`handleISORequest ${JSON.stringify(n2kMsg)}`)

  switch (n2kMsg.fields.PGN) {
  case 126996:  // Product Information request
    sendProductInformation(device)
    break;
  case 60928:   // ISO address claim request
    sendAddressClaim(device)
    break;
  case 126464:
    sendPGNList(device)
    break;
  default:
    debug(`Got unsupported ISO request for PGN ${n2kMsg.fields.PGN}. Sending NAK.`)
    sendNAKAcknowledgement(device, n2kMsg.src, n2kMsg.fields.PGN)
  }
}
  
function handleGroupFunction(device, n2kMsg) {
  debug(`handleGroupFunction ${JSON.stringify(n2kMsg)}`)
  if(n2kMsg.fields["Function Code"] === 'Request') {
    handleRequestGroupFunction(n2kMsg)
  } else if(n2kMsg.fields["Function Code"] === 'Command') {
    handleCommandGroupFunction(n2kMsg)
  } else {
    debug('Got unsupported Group Function PGN:', JSON.stringify(n2kMsg))
  }

  function handleRequestGroupFunction(n2kMsg) {
    // We really don't support group function requests for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    debug("Sending 'PGN Not Supported' Group Function response for requested PGN", n2kMsg.fields.PGN)
    
    const acknowledgement = {
      pgn: 126208,
      dst: n2kMsg.src,
      "Function Code": 1,
      "PGN": n2kMsg.fields.PGN,
      "PGN error code": 4,
      "Transmission interval/Priority error code": 0,
      "# of Parameters": 0
    }
    sendPGN(device, acknowledgement)
  }

  function handleCommandGroupFunction(n2kMsg) {
    // We really don't support group function commands for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"
    debug("Sending 'PGN Not Supported' Group Function response for commanded PGN", n2kMsg.fields.PGN)

    const acknowledgement = {
      pgn: 126208,
      dst: n2kMsg.src,
      "Function Code": 1,
      "PGN": n2kMsg.fields.PGN,
      "PGN error code": 4,
      "Transmission interval/Priority error code": 0,
      "# of Parameters": 0
    }
    sendPGN(device, acknowledgement)
  }
}

function handleISOAddressClaim(device, n2kMsg) {
  debug(`Checking ISO address claim. ${JSON.stringify(n2kMsg)}`)

  if ( n2kMsg.src != device.address ) {
    debug('not conflicting address')
    return
  }

  const uint64ValueFromReceivedClaim = getISOAddressClaimAsUint64({
    uniqueNumber: parseInt(n2kMsg.fields["Unique Number"]),
    manufacturerCode: n2kMsg.fields["Manufacturer Code"].value || n2kMsg.fields["Manufacturer Code"],
    deviceFunction: n2kMsg.fields["Device Function"],
    deviceClass: n2kMsg.fields["Device Class"].value || n2kMsg.fields["Device Class"],
    deviceInstanceLower: n2kMsg.fields["Device Instance Lower"],
    deviceInstanceUpper: n2kMsg.fields["Device Instance Upper"],
    systemInstance: n2kMsg.fields["System Instance"],
    industryGroup: n2kMsg.fields["Industry Group"].value || n2kMsg.fields["Industry Group"]
  })
  const uint64ValueFromOurOwnClaim = getISOAddressClaimAsUint64(PgnSupport.addressClaim(ownAddr))

  if(uint64ValueFromOurOwnClaim.lt(uint64ValueFromReceivedClaim)) {
    debug(`Address conflict detected! Kept our address as ${device.address}.`)
    sendAddressClaim(device)      // We have smalfgler address claim data -> we can keep our address -> re-claim it
  } else if(uint64ValueFromOurOwnClaim.gt(uint64ValueFromReceivedClaim)) {
    increaseOwnAddress(Device)    // We have bigger address claim data -> we have to change our address
    sendAddressClaim(device)
    debug(`Address conflict detected! Changed our address to ${device.address}.`)
  } 
  
  function increaseOwnAddress(device) {
    device.address = (device.address + 1) % 253
  }
}

function sendAddressClaim(device) {
  debug(`Sending address claim ${device.address}`)
  
  const addressClaim = {
    pgn: 60928,
    dst: 255,
    "Unique Number": 1263,
    "Manufacturer Code": 273,   // Made up, not recognized by standard products
    "Device Function": 130,      // PC gateway
    "Device Class": 25,          // Inter/Intranetwork Device
    "Device Instance Lower": 0,
    "Device Instance Upper": 0,
    "System Instance": 0,
    "Industry Group": 4          // Marine
  }
  sendPGN(device, addressClaim)
}




function sendProductInformation(device) {
  debug("Sending product info..")

  const productInfo = {
    pgn: 126996,
    dst: 255,
    "NMEA 2000 Version": 1300,
    "Product Code": 667,   // Just made up..
    "Model ID": "Signal K",
    "Software Version Code": "1.0",
    "Model Version": "canbusjs",
    "Model Serial Code": "123456",
    "Certification Level": 0,
    "Load Equivalency": 1
  }
  sendPGN(device, productInfo)
}

function sendNAKAcknowledgement(device, src, requestedPGN) {
  const acknowledgement = {
    pgn: 59392,
    dst: src,
    Control: 1,
    "Group Function": 255,
    PGN: requestedPGN
  }
  sendPGN(device, acknowledgement)
}

function sendPGNList(device, src) {
  //FIXME: for now, adding everything that signalk-to-nmea2000 supports
  //need a way for plugins, etc. to register the pgns they provide
  const pgnList = {
    pgn: 126464,
    dst: src,
    "Function Code": 0,
    list: [
      { PGN: 60928 },
      { PGN: 126996 },
      { PGN: 126464 },
      { PGN: 128267 },
      { PGN: 129794 },
      { PGN: 129038 },
      { PGN: 129041 },
      { PGN: 127506 },
      { PGN: 127508 },
      { PGN: 129026 },
      { PGN: 129025 },
      { PGN: 129029 },
      { PGN: 127250 },
      { PGN: 130306 }
    ]
  }
  sendPGN(device, pgnList)
}

function getISOAddressClaimAsUint64({uniqueNumber, manufacturerCode, deviceFunction, deviceClass, deviceInstanceLower, deviceInstanceUpper, systemInstance, industryGroup}) {
  // Interpret all 8 data bytes as single uint64
  return uint64(uniqueNumber)
    .add(uint64(manufacturerCode).shiftLeft(21))
    .add(uint64(deviceInstanceLower).shiftLeft(32))
    .add(uint64(deviceInstanceUpper).shiftLeft(35))
    .add(uint64(deviceFunction).shiftLeft(40))
    .add(uint64(deviceClass).shiftLeft(49))
    .add(uint64(systemInstance).shiftLeft(56))
    .add(uint64(industryGroup).shiftLeft(60))
    .add(uint64(1).shiftLeft(63))
}

module.exports = CanDevice