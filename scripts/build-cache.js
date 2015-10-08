/** Small helper script to cache the OUI db to redis. */
var debug = require('debug')('build-cache');
var _ = require('underscore');
var redis = require('redis');

const REDISDB = (process.env.REDISDB ? parseInt(process.env.REDISDB) : 4);

// redis client
var db = redis.createClient();
if (!db) {
    debug("redis create failed");
    process.exit(1);
}
db.select(REDISDB, function(err) {
    if (err)
        debug("redis select error: " + err);
});
db.on("error", function (err) {
    debug("redis connect or fatal error: " + err);
    process.exit(1);
});

db.set('mac:lastwritets', Date.now());

var buf = "";
var v = {};
var k = undefined;
var addr = [];

var write = function() {
    if (k === undefined) return;
    v['ts'] = Date.now();
    v['country'] = addr[addr.length-1];
    _.each(addr.splice(0,(addr.length-1)), function(elem, idx) {
        v['address'+(idx+1)] = elem;
    });

    db.hmset('mac:'+k, v, function(err, results) {
        if (err) debug('redis hmset error: ' + err);
    });
};

var handleline = function(l) {
    if (l.indexOf('(hex') >= 0) {
        write();

        // new element
        k = l.split(' ')[0].trim().replace(/\-/g,'').toLowerCase();
        v = {
            company : l.split('\t\t')[1],
        }
        addr = [];

    } else if (l.indexOf('(base') < 0 && l.indexOf('Generated:') < 0) {
        addr.push(l.trim());
    }
};

var handlechunk = function(chunk) {
    buf += chunk;
    var idx = buf.indexOf('\n');
    while (idx>=0) {
        var l = buf.slice(0,idx).trim();
        if (l.length>0)
            handleline(l);
        buf = buf.slice((idx+1));
        idx = buf.indexOf('\n');
    }
};

process.stdin.setEncoding('utf8');

process.stdin.on('readable', function() {
    var chunk = process.stdin.read();
    if (chunk !== null) {
        handlechunk(chunk);
    }
});

process.stdin.on('end', function() {
    write();
    debug("ready!");
    db.quit();
    process.exit(0);
});