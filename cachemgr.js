/**
 * Fetches and parses the IEEE OUI database once a day and keeps a copy in 
 * a local Redis store.
 */
var debug = require('debug')('cachemgr')
var _ = require('underscore');
var http = require('http');
var redis = require('redis');

// some configs
const OUIDB = "http://standards.ieee.org/develop/regauth/oui/oui.txt";
const UPDATEIV = 24*3600*1000;
const ERRUPDATEIV = 2*3600*1000;

// redis client
var db = redis.createClient();
db.on("error", function (err) {
    debug("redis error: " + err);
});

/**
 * Update the manufacturer information from the IEEE site.
 */
var update_cache = function() {
    debug("update_cache");
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

    http.get(OUIDB, function(res) {
	debug("update_cache got data: " + res.statusCode);
	res.setEncoding('utf8');
	res.on('data', handlechunk);
	res.on('end', function(chunk) {
	    handlechunk(chunk);
	    write();

	    debug("update_cache done!");
	    db.set('mac:lastwritesucc',true);
	    setInterval(update_cache, UPDATEIV); // next update in 24h
	});
    }).on('error', function(e) {
	debug("update_cache error: " + e.message);
	db.set('mac:lastwritesucc',false);
	setInterval(update_cache, ERRUPDATEIV); // try again in couple of hours
    });
};

// start the first update
update_cache();