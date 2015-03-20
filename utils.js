var debug = require('debug')('mserver:utils')
var _ = require('underscore');

/** Parse whois data to JSON. */
var parsewhois = exports.parsewhois = function(data) {
    var res = { netblock : undefined, asblock : undefined };
    var blocks = data.split('\n\n');
    _.each(blocks,function(b) {
	var tmpblock = {};
	var lines = b.split('\n');
	_.each(lines, function(line) {
	    if (line.length <= 1 || line.indexOf('%')==0 || 
		line.indexOf(': ')<0) {
		return;
	    }
	    var tmp = line.split(': ');
	    var k = tmp[0].trim();
	    var v = tmp[1].trim();
	    if (tmpblock[k])
		tmpblock[k] += ';' + v;
	    else
		tmpblock[k] = v;
	});
	if (tmpblock.origin)
	    res.asblock = tmpblock;
	else if (tmpblock.inetnum)
	    res.netblock = tmpblock;
    });
    return res;
};
