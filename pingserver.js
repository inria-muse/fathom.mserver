var url = require('url');
var qs = require('querystring');
var http = require('http');
var net = require('net');
var dgram = require('dgram');
var crypto = require('crypto');

// external dependencies
var debug = require('debug')('pingserver');
var WebSocketServer = require('ws').Server;
var _ = require('underscore');

/* timer helper */
function timestamper() {
    // current time is calculated as baseTime + (process.hrtime() - baseTimeHr)
    var baseTime = new Date().getTime(); // milliseconds
    var baseTimeHr = process.hrtime();   // [seconds, nanosec]

    /* Source: https://github.com/firefoxes/diff-hrtime
     * @return node.js hrtime diff
     */
    var diffHrtime = function(b, a){
        // desctructure/capture secs and nanosecs
        var as = a[0], ans = a[1],
        bs = b[0], bns = b[1],
        ns = ans - bns, // nanosecs delta, can overflow (will be negative)
        s = as - bs // secs delta
        if (ns < 0) { // has overflowed
            s -= 1 // cut a second
            ns += 1e9 // add a billion nanosec (to neg number)
        }
        return s + ns/1e9; 
    };

    // get base reference time
    this.getbasets = function() {
        return baseTime + 0.0;
    };
    
    // get current time
    this.getts = function() {
        var hrt = process.hrtime();
        var diff = diffHrtime(baseTimeHr, hrt);
        return baseTime + diff; 
    };

    // diff between now and ts
    this.diff = function(ts) {
        return Math.abs(ts - this.getts());
    };
};

/* UDP server */
function udps(port) {
    var tr = new timestamper();
    var srv = dgram.createSocket('udp4');

    srv.on('message', function(buf,rinfo) {
	var ts = tr.getts();
	debug("req from " + rinfo.address + ":" + rinfo.port);

	var data = buf.toString('utf8');
	try {
	    var obj = JSON.parse(data);	
	    if (obj!==undefined && obj.seq!==undefined) {
		obj.r = ts;
		obj.ra = rinfo.address;
		obj.rp = rinfo.port;

		var respstr = JSON.stringify(obj);
		var bufout = new Buffer(respstr,'utf8');
		srv.send(bufout,0,bufout.length,rinfo.port,rinfo.address);
	    }
	} catch (e) {
	    debug('malformed ping request: '+e);
	    debug(data);
	}
    });

    srv.on('error', function(e) {		    
	debug('udp error: '+e);
    });

    srv.bind(port);
    debug("udp server listening on *:"+port+"...");
};

/* TCP server */
function tcps(port) {
    var srv = net.createServer(function(s) {
	// new connection!
	debug("req from " + s.remoteAddress + ":" + s.remotePort);
	var tr = new timestamper();

	var buf = '';
	s.setEncoding('utf8');
	s.on('data', function(data) {
	    var ts = tr.getts();
	    var delim = data.indexOf('\n\n');
	    while (delim>0) {
		buf += data.substring(0,delim);
		try {
		    var obj = JSON.parse(buf);
		    if (obj && obj.seq!==undefined) {
			obj.r = ts;
			obj.ra = s.remoteAddress;
			obj.rp = s.remotePort;
			var respstr = JSON.stringify(obj);
			s.write(respstr+"\n\n");
		    }
		} catch (e) {
		    debug('malformed ping request: '+e);
		    debug(buf);
		}
		data = data.substring(delim+2);
		delim = data.indexOf('\n\n');
		buf = '';
	    }
	    buf += data
	});
    });

    srv.listen(port, function() {
	debug("tcp server listening on *:"+port+"...");
    });

    srv.on('error', function(e) {		    
	debug('tcp error: '+e);
    });
};

/* WebSocket server */
function wss(port) {
    var srv = new WebSocketServer({port: port});
    srv.on('connection', function(ws) {
	// TODO: add this to the underlying library!
	debug("req from " + ws.remoteAddress + ":" + ws.remotePort);
	var tr = new timestamper();

	ws.on('message', function(msg) {
	    var ts = tr.getts();
	    try {
		var obj = JSON.parse(msg);
		if (obj && obj.seq!==undefined) {
		    obj.r = ts;
		    //obj.ra = ws.remoteAddress;
		    //obj.rp = ws.remotePort;
		    var respstr = JSON.stringify(obj);
		    ws.send(respstr);
		}
	    } catch (e) {
		debug('malformed ping request: '+e);
		debug(msg);
	    }
	});

	ws.on('error', function(e) {		    
	    debug('ws error: '+e);
	});

    });
}
