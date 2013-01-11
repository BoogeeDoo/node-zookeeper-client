/**
 * Copyright (c) 2013 Yahoo! Inc. All rights reserved.
 */

/**
 * Automatically generate all ZooKeeper related protocol classes.
 *
 * @module zookeeper.jute
 */

var fs = require('fs');
var util = require('util');
var jsonu = require('jsonutil');

// Constants.
/*jslint nomen: true*/
var SPECIFICATION_FILE = __dirname + '/specification.json';
var PROTOCOL_VERSION = 0;
var OPERATION_CODES = {
    NOTIFICATION : 0,
    CREATE : 1,
    DELETE : 2,
    EXISTS : 3,
    GET_DATA : 4,
    SET_DATA : 5,
    GET_ACL : 6,
    SET_ACL : 7,
    GET_CHILDREN : 8,
    SYNC : 9,
    PING : 11,
    GET_CHILDREN2 : 12,
    CHECK : 13,
    MULTI : 14,
    AUTH : 100,
    SET_WATCHES : 101,
    SASL : 102,
    CREATE_SESSION : -10,
    CLOSE_SESSION : -11,
    ERROR : -1
};

var XID_NOTIFICATION = -1;
var XID_PING = -2;
var XID_AUTHENTICATION = -4;

/**
 * The prototype class for all Zookeeper jute protocol classes.
 *
 * @class Record
 * @constructor
 * @param specification {Array} The array of record attribute specification.
 * @param args {Array} The constructor array of the Record class.
 */
function Record(specification, args) {
    if (!Array.isArray(specification)) {
        throw new Error('specification must a valid Array.');
    }

    this.specification = specification;
    args = args || [];

    var self = this,
        match;

    self.specification.forEach(function (attribute, index) {
        switch (attribute.type) {
        case 'int':
            if (typeof args[index] === 'number') {
                self[attribute.name] = args[index];
            } else {
                self[attribute.name] = 0;
            }
            break;
        case 'long':
            // Long is represented by a buffer of 8 bytes in big endian since
            // Javascript does not support native 64 integer.
            self[attribute.name] = new Buffer(8);

            if (Buffer.isBuffer(args[index])) {
                args[index].copy(self[attribute.name]);
            } else {
                self[attribute.name].fill(0);
            }
            break;
        case 'buffer':
            if (Buffer.isBuffer(args[index])) {
                self[attribute.name] = new Buffer(args[index].length);
                args[index].copy(self[attribute.name]);
            } else {
                self[attribute.name] = undefined;
            }
            break;
        case 'ustring':
            if (typeof args[index] === 'string') {
                self[attribute.name] = args[index];
            } else {
                self[attribute.name] = undefined;
            }
            break;
        case 'boolean':
            if (typeof args[index] === 'boolean') {
                self[attribute.name] = args[index];
            } else {
                self[attribute.name] = false;
            }
            break;
        default:
            if ((match = /^vector<(\w+)>$/.exec(attribute.type)) !== null) {
                if (Array.isArray(args[index])) {
                    self[attribute.name] = args[index];
                } else {
                    self[attribute.name] = undefined;
                }
            } else if ((match = /^data\.(\w+)$/.exec(attribute.type)) !== null) {
                if (args[index] instanceof Record) {
                    self[attribute.name] = args[index];
                } else {
                    self[attribute.name] = new module.exports.data[match[1]]();
                }
            } else {
                throw new Error('Unknown type: ' + attribute.type);
            }
        }
    });
}

function byteLength(type, value) {
    var size = 0,
        match;

    switch (type) {
    case 'int':
        size = 4;
        break;
    case 'long':
        size = 8;
        break;
    case 'buffer':
        // buffer length + buffer content
        size = 4;
        if (Buffer.isBuffer(value)) {
            size += value.length;
        }
        break;
    case 'ustring':
        // string buffer length + content
        size = 4;
        if (typeof value === 'string') {
            size += Buffer.byteLength(value);
        }
        break;
    case 'boolean':
        size = 1;
        break;
    default:
        if ((match = /^vector<(\w+)>$/.exec(type)) !== null) {
            // vector size + vector content
            size = 4;
            if (Array.isArray(value)) {
                value.forEach(function (item) {
                    size += byteLength(match[1], item);
                });
            }
        } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
            size = value.byteLength();
        } else {
            throw new Error('Unknown type: ' + type);
        }
    }

    return size;
}

/**
 * Calculate and return the size of the buffer which is need to serialize this
 * record.
 *
 * @method byteLength
 * @return {Number} The number of bytes.
 */
Record.prototype.byteLength = function () {
    var self = this,
        size = 0;

    self.specification.forEach(function (attribute) {
        size += byteLength(attribute.type, self[attribute.name]);
    });

    return size;
};

function serialize(type, value, buffer, offset) {
    var bytesWritten = 0,
        length = 0,
        match;

    switch (type) {
    case 'int':
        buffer.writeInt32BE(value, offset);
        bytesWritten = 4;
        break;
    case 'long':
        // Long is represented by a buffer of 8 bytes in big endian since
        // Javascript does not support native 64 integer.
        value.copy(buffer, offset);
        bytesWritten = 8;
        break;
    case 'buffer':
        if (Buffer.isBuffer(value)) {
            buffer.writeInt32BE(value.length, offset);
            bytesWritten = 4;

            value.copy(buffer, offset + bytesWritten);
            bytesWritten += value.length;
        } else {
            buffer.writeInt32BE(-1, offset);
            bytesWritten = 4;
        }
        break;
    case 'ustring':
        if (typeof value === 'string') {
            length = Buffer.byteLength(value);
            buffer.writeInt32BE(length, offset);
            bytesWritten = 4;

            new Buffer(value).copy(buffer, offset + bytesWritten);
            bytesWritten += length;
        } else {
            buffer.writeInt32BE(-1, offset);
            bytesWritten += 4;
        }
        break;
    case 'boolean':
        buffer.writeUInt8(value ? 1 : 0, offset);
        bytesWritten += 1;
        break;
    default:
        if ((match = /^vector<(\w+)>$/.exec(type)) !== null) {
            // vector size + vector content
            if (Array.isArray(value)) {
                buffer.writeInt32BE(value.length, offset);
                bytesWritten += 4;

                value.forEach(function (item) {
                    bytesWritten += serialize(
                        match[1],
                        item,
                        buffer,
                        offset + bytesWritten
                    );
                });
            } else {
                buffer.writeInt32BE(-1, offset);
                bytesWritten += 4;
            }
        } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
            bytesWritten += value.serialize(buffer, offset + bytesWritten);
        } else {
            throw new Error('Unknown type: ' + type);
        }
    }

    return bytesWritten;
}

/**
 * Serialize the record content to a buffer.
 *
 * @method serialize
 * @param buffer {Buffer} A buffer object.
 * @param offset {Number} The offset where the write starts.
 * @return {Number} The number of bytes written.
 */
Record.prototype.serialize = function (buffer, offset) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer must an instance of Node.js Buffer class.');
    }

    if (offset < 0 || offset >= buffer.length) {
        throw new Error('offset: ' + offset + ' is out of buffer range.');
    }

    var self = this,
        size = this.byteLength();

    if (offset + size > buffer.length) {
        throw new Error('buffer does not have enough space.');
    }

    self.specification.forEach(function (attribute) {
        offset += serialize(
            attribute.type,
            self[attribute.name],
            buffer,
            offset
        );
    });

    return size;
};

function deserialize(type, buffer, offset) {
    var bytesRead = 0,
        length = 0,
        match,
        value,
        result;

    switch (type) {
    case 'int':
        value = buffer.readInt32BE(offset);
        bytesRead = 4;
        break;
    case 'long':
        // Long is represented by a buffer of 8 bytes in big endian since
        // Javascript does not support native 64 integer.
        value = new Buffer(8);
        buffer.copy(value, 0, offset, offset + 8);
        bytesRead = 8;
        break;
    case 'buffer':
        length = buffer.readInt32BE(offset);
        bytesRead = 4;

        if (length === -1) {
            value = undefined;
        } else {
            value = new Buffer(length);
            buffer.copy(
                value,
                0,
                offset + bytesRead,
                offset + bytesRead + length
            );

            bytesRead += length;
        }
        break;
    case 'ustring':
        length = buffer.readInt32BE(offset);
        bytesRead = 4;

        if (length === -1) {
            value = undefined;
        } else {
            value = buffer.toString(
                offset + bytesRead,
                offset + bytesRead + length
            );

            bytesRead += length;
        }
        break;
    case 'boolean':
        value = buffer.readUInt8(offset) === 1 ? true : false;
        bytesRead = 1;
        break;
    default:
        if ((match = /^vector<(\w+)>$/.exec(type)) !== null) {
            length = buffer.readInt32BE(offset);
            bytesRead = 4;

            if (length === -1) {
                value = undefined;
            } else {
                value = [];
                while (length > 0) {
                    result = deserialize(match[1], buffer, offset + bytesRead);
                    value.push(result.value);
                    bytesRead += result.bytesRead;
                    length -= 1;
                }
            }
        } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
            value = new module.exports.data[match[1]]();
            bytesRead = value.deserialize(buffer, offset);
        } else {
            throw new Error('Unknown type: ' + type);
        }
    }

    return {
        value : value,
        bytesRead : bytesRead
    };
}

/**
 * De-serialize the record content from a buffer.
 *
 * @method deserialize
 * @param buffer {Buffer} A buffer object.
 * @param offset {Number} The offset where the read starts.
 * @return {Number} The number of bytes read.
 */
Record.prototype.deserialize = function (buffer, offset) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer must an instance of Node.js Buffer class.');
    }

    if (offset < 0 || offset >= buffer.length) {
        throw new Error('offset: ' + offset + ' is out of buffer range.');
    }

    var self = this,
        bytesRead = 0,
        result;

    self.specification.forEach(function (attribute) {
        result = deserialize(attribute.type, buffer, offset + bytesRead);
        self[attribute.name] = result.value;
        bytesRead += result.bytesRead;
    });

    return bytesRead;
};


/**
 * This class represent the request the client sends over the wire to ZooKeeper
 * server.
 *
 * @class Request
 * @constructor
 * @param header {Record} The request header record.
 * @param payload {payload} The request payload record.
 */
function Request(header, payload) {
    this.header = header;
    this.payload = payload;
}

/**
 * Serialize the request to a buffer.
 * @method toBuffer
 * @return {Buffer} The buffer which contains the serialized request.
 */
Request.prototype.toBuffer = function () {
    var size = 0,
        offset = 0,
        buffer;

    if (this.header) {
        size += this.header.byteLength();
    }

    if (this.payload) {
        size += this.payload.byteLength();
    }

    // Needs 4 extra for the length field (Int32)
    buffer = new Buffer(size + 4);

    buffer.writeInt32BE(size, offset);
    offset += 4;

    if (this.header) {
        offset += this.header.serialize(buffer, offset);
    }

    if (this.payload) {
        offset += this.payload.serialize(buffer, offset);
    }

    return buffer;
};

/**
 * This class represent the response that ZooKeeper sends back to the client.
 *
 * @class Responsee
 * @constructor
 * @param header {Record} The request header record.
 * @param payload {payload} The request payload record.
 */
function Response(header, payload) {
    this.header = header;
    this.payload = payload;
}

/**
 * Serialize the request to a buffer.
 * @method toBuffer
 * @param buffer {Buffer} Buffer from which the response will be de-serialized.
 * @return {Number} The number of bytes read from the buffer.
 */
Response.prototype.fromBuffer = function (buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer must be a valid Node.js Buffer object.');
    }

    if (buffer.length < 4) {
        throw new Error('buffer has to be at least 4 bytes in length.');
    }

    var size = 0,
        offset = 0;

    size = buffer.readInt32BE(offset);
    offset += 4;

    if (this.header) {
        offset += this.header.deserialize(buffer, offset);
    }

    if (this.payload) {
        offset += this.payload.deserialize(buffer, offset);
    }

    return offset;
};

/**
 * Generate a Protocol class according to the specification.
 * @for module.jute
 * @method generateClass
 */
function generateClass(specification, moduleName, className) {
    var spec = specification[moduleName][className],
        constructor;

    if (moduleName === 'protocol') {
        constructor = function () {
            Record.call(this, spec, Array.prototype.slice.call(arguments, 0));
        };

        util.inherits(constructor, Record);

        return constructor;
    }
}

var exports = module.exports;

// Exports constants
exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
exports.OPERATION_CODES = OPERATION_CODES;

exports.XID_NOTIFICATION = XID_NOTIFICATION;
exports.XID_PING = XID_PING;
exports.XID_AUTHENTICATION = XID_AUTHENTICATION;

// Exports classes
exports.Request = Request;
exports.Response = Response;

// Automatically generates and exports all protocol and data classes.
var specification = jsonu.readFileSync(SPECIFICATION_FILE);

Object.keys(specification).forEach(function (moduleName) {
    // Modules like protocol or data.
    exports[moduleName] = exports[moduleName] || {};

    Object.keys(specification[moduleName]).forEach(function (className) {
        exports[moduleName][className] =
            generateClass(specification, moduleName, className);
    });
});


