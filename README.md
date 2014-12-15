# Fathom MSERVER

Node REST API to support various lookups and reverse measurements
for Fathom extension.

## Dependencies

$ apt-get install geoip-bin libgeoip1 redis-server 
$ npm install pm2@latest -g

## Running

The app is managed by pm2 ('pm2 start processes.json' or 'npm start').

Run 'pm2 save' to store the currently running apps so that they will be 
restarted upon reboot.

## Geolocation

The geolocation is based on a locally installed MaxMind DB (lite by default 
on linux, on cmon we have a purchazed full db from 2011). The DB access is 
by using the commandline 'geoiplookup[6]' tool. If no IP address is given,
the service responds with the geolocation of the public IP of the request.

### Request (GET or POST):

http://localhost<:port>/geo</ipv4>
http://localhost<:port>/geo</ipv6>

### Response: 

{
 "req-ts"  : 1406894147226,
 "req"     : "132.227.126.1",
 "cc"      : "FR",
 "country" : "France"
}

## Mac address lookup

The API server reads once a day the latest OUI database from IEEE,
 
http://standards.ieee.org/develop/regauth/oui/oui.txt 

, and provides a simple REST API for mapping MAC addresses to device 
manufacturer information.

### Request (GET or POST):

http://localhost:3004/mac/xx-xx-xx[-xx-xx-xx]
http://localhost:3004/mac/xxxxxx[xxxxxx]

Only first six characters are used in mapping, the rest is ignored.

### Response: 

{
  'req-ts'   : <request timestamp>,
  'db-ts'    : <last database update timestamp>,
  'oui'      : "xxxxxx",
  'company'  : "Company Inc",
  'address1' : "",              # first address line
  <...>
  'addressX' : "",              # last address line before country
  'country'  : "United States"  # last address line
}

