require('jaydata-reso');
var fs = require('fs')
  , crypto = require("crypto")
  , randomstring = require("just.randomstring")
  , nonce = randomstring(16);

window.DOMParser = require('xmldom').DOMParser;

$data.ODataServer = function(type, indexLocation, db){

    var connect = require('connect');
    var domain = require('domain');
   
    var config = typeof type === 'object' ? type : {};
    var type = config.type || type;
    config.database = config.database || db || type.name;
    if (!config.provider) config.provider = {};
    config.provider.name = config.provider.name || 'mongoDB';
    config.provider.databaseName = config.provider.databaseName || config.database || db || type.name;
    config.provider.responseLimit = config.provider.responseLimit || config.responseLimit || 100;
    config.provider.user = config.provider.user || config.user;
    config.provider.checkPermission = config.provider.checkPermission || config.checkPermission;
   
    var serviceType = $data.Class.defineEx(type.fullName + '.Service', [type, $data.ServiceBase]);
    serviceType.annotateFromVSDoc();

//
// read index file
//
    if (config.externalIndex) {
      INDEX = readIndexFile(indexLocation);
    }

    var basicAuthFn = function(req, res, next){
        if (!config.basicAuth && !config.rootAuth) {
          return next();
        }
        var callback = config.rootAuth ? function(){ connect.basicAuth(config.rootAuth)(req, res, next); } : next;
        if (typeof config.basicAuth == 'function'){
            connect.basicAuth(config.basicAuth)(req, res, callback);
        }else if (typeof config.basicAuth == 'object' && config.basicAuth.username && config.basicAuth.password){
            connect.basicAuth(config.basicAuth.username, config.basicAuth.password)(req, res, callback);
        }else { 
          callback();}
    };
    
    var digestAuthFn = function(req, res, next){
      if (!config.digestAuth) {
        return next();
      }
      if (typeof config.digestAuth == 'function'){
        digestAuth(config.digestAuth, req, res, config.authRealm, next);
      } else {
        next();
      }
    };

    var postProcessFn = function(req, res){
      if (config.postProcess) {
        if (typeof config.postProcess == 'function'){
          var clearForProcessing = function(req) {
            if (!req.reso.memberName) {
              req.reso.memberName = "System";
            }
            req.reso.requestor = req.connection.remoteAddress;
            if (req.reso.memberName == "$metadata") {
              req.reso.memberName = "Metadata";
            }
            req.reso.endTime = new Date().getTime();
            config.postProcess(req.method, req.reso);
          }
//
// server needs to complete its processing so results are delayed by 10 ms to allow thread to complete
//
          var waits = 0;
          var waitTime = config.processWait;
          var timeout_wrapper = function(req) {
            return function() {
              ++waits;
console.log("Wait " + waits + " times for " + req.reso.startTime);
              if (req.reso.resultSize) {
                clearForProcessing(req);
              } else {
                if (waits > 2) {
console.log("Shutdown Wait for " + req.reso.startTime);
console.log("Consider increading PROCESS_WAIT configuration value");
                  req.reso.resultSize = 1;
                  req.reso.keyValue = "unknown";
                  clearForProcessing(req);
                } else {
                  timeout = setTimeout(fn, waitTime);
                }
              }
            };
          };
          var fn = timeout_wrapper(req);
          var timeout = setTimeout(fn, waitTime);
          if (req.reso.resultSize) {
            clearTimeout(timeout);
            clearForProcessing(req);
          }

        }
      }
    };

/*
    var corsFn = function(req, res, next){
        if (config.CORS !== false){
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
            res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,X-HTTP-Method-Override,X-PINGOTHER,Content-Type,MaxDataServiceVersion,DataServiceVersion,Authorization,Accept");
            res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS,PUT,MERGE,PATCH,DELETE");
            if (req.method === "OPTIONS"){
                res.setHeader("Access-Control-Allow-Credentials", "false");
                res.setHeader("Access-Control-Max-Age", "31536000");
                res.setHeader("Cache-Control", "max-age=31536000");
                res.end();
            }else{
                next();
            }
        }else next();
    };
*/
    
    var queryFn = function(req, res, next){
        if (!req.query){
            connect.query()(req, res, next);
        }else next();
    };

    var bodyFn = function(req, res, next){
        if (!req.body){
          connect.json()(req, res, function(err){
            if (err) return next(err);
            connect.urlencoded()(req, res, next);
          });

        }else next();
    };
    
    var simpleBodyFn = function(req, res, next){
        $data.JayService.OData.Utils.simpleBodyReader()(req, res, next);
    };
    
    var errorFn = function(req, res, next, callback){
        var reqd = domain.create();
        reqd.add(req);
        reqd.add(res);
        reqd.add(next);
        reqd.on('error', function(err){
            try{
                console.error(err);
                next(err);
            }catch (derr){
                console.error('Error sending 500', derr, req.url);
                reqd.dispose();
            }
        });
        reqd.run(function(){
            callback();
        });
    };
    
    var errorHandlerFn = function(err, req, res, next){
        if (config.errorHandler){
            connect.errorHandler.title = typeof config.errorHandler == 'string' ?  config.errorHandler : config.provider.databaseName;
            connect.errorHandler()(err, req, res, next);
        }else next(err);
    };
    
    return function(req, res, next){
        var self = this;
//
// hide recursive calls that are denoted with an endpoint  "/$batch"
//
        var startStamp = new Date();
        var endPointURL = unescape(req.url);
        if (endPointURL != "/$batch") {
          if (config.logEntry) {
console.log(startStamp + " " + "Request " + req.method + " " + endPointURL + " received from " + req.connection.remoteAddress); 
          }     
        }     
        if (config.provider.checkPermission){
            Object.defineProperty(req, 'checkPermission', {
                value: config.provider.checkPermission.bind(req),
                enumerable: true
            });
            config.provider.checkPermission = req.checkPermission;
        }

/*
        if (req.method === 'OPTIONS') {
console.log('!OPTIONS');
          var headers = {};
// IE8 does not allow domains to be specified, just the *
          headers["Access-Control-Allow-Origin"] = req.headers.origin;
          headers["Access-Control-Allow-Methods"] = "HEAD,POST,GET,OPTIONS,PUT,MERGE,DELETE";
          headers["Access-Control-Allow-Headers"] = "Host,Accept-Language,Accept-Encoding,Connection,User-Agent,Origin,Cache-Control,Pragma,X-Requested-With,X-HTTP-Method-Override,X-PINGOTHER,Content-Type,MaxDataServiceVersion,DataServiceVersion,Authorization,Accept";
          headers["Access-Control-Allow-Credentials"] = "false";
//          headers["Access-Control-Max-Age"] = '86400'; // 24 hours
//          headers["Access-Control-Max-Age"] = "31536000";
//          headers["Cache-Control"] = "max-age=31536000";
          headers["Access-Control-Max-Age"] = "1";
          headers["Cache-Control"] = "max-age=1";
          res.writeHead(200, headers);
          res.end();
        } else {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Headers", "Host,Accept-Language,Accept-Encoding,Referer,Connection,User-Agent,Origin,Cache-Control,Pragma,x-requested-with,X-HTTP-Method-Override,X-PINGOTHER,Content-Type,MaxDataServiceVersion,DataServiceVersion,Authorization,Accept");
        res.setHeader("Access-Control-Allow-Methods", "HEAD,POST,GET,OPTIONS,PUT,MERGE,DELETE");
        res.setHeader('Access-Control-Allow-Credentials', "false");
//        res.setHeader("Access-Control-Max-Age", "31536000");
//        res.setHeader("Cache-Control", "max-age=31536000");
        res.setHeader("Access-Control-Max-Age", "1");
        res.setHeader("Cache-Control", "max-age=1");
*/

        switch(config.authType) {
          case "Basic":
            basicAuthFn(req, res, function(){
              config.provider.user = config.user = req.user || req.remoteUser || config.user || config.provider.user || 'anonymous';
              queryFn(req, res, function(){
                bodyFn(req, res, function(){
                  simpleBodyFn(req, res, function(){
                    errorFn(req, res, next, function(){

                      req.reso = {
                        "indexFileName" : indexLocation, 
                        "externalIndex" : config.externalIndex,
                        "startTime": startStamp.getTime(),
                        "userName" : config.provider.user 
                      }
                      $data.JayService.createAdapter(
                        serviceType, 
                        function() {
                          return new serviceType(config.provider);
                        }
                      ).call(
                          self, 
                          req, 
                          res, 
                          function(err) {
                            if (typeof err === 'string') err = new Error(err);
                            errorHandlerFn(err, req, res, next);
                          }
                      );
                      postProcessFn(req, res);

                    });
                  });
                });
              });
            });
            break
          case "Digest":
            digestAuthFn(req, res, function(){
              config.provider.user = config.user = req.user || req.remoteUser || config.user || config.provider.user || 'anonymous';
              queryFn(req, res, function(){
                bodyFn(req, res, function(){
                  simpleBodyFn(req, res, function(){
                    errorFn(req, res, next, function(){

                      req.reso = {
                        "indexFileName" : indexLocation, 
                        "externalIndex" : config.externalIndex, 
                        "startTime": startStamp.getTime(),
                        "userName" : config.provider.user 
                      }
                      $data.JayService.createAdapter(
                        serviceType, 
                        function() {
                          return new serviceType(config.provider);
                        }
                      ).call(
                          self, 
                          req, 
                          res, 
                          function(err) {
                            if (typeof err === 'string') err = new Error(err);
                            errorHandlerFn(err, req, res, next);
                          }
                      );
                      postProcessFn(req, res);

                    });
                  });
                });
              });
            });
            break
          default:
            config.provider.user = config.user = req.user || req.remoteUser || config.user || config.provider.user || 'anonymous';
            queryFn(req, res, function(){
              bodyFn(req, res, function(){
                simpleBodyFn(req, res, function(){
                  errorFn(req, res, next, function(){

                      req.reso = {
                        "indexFileName" : indexLocation, 
                        "externalIndex" : config.externalIndex, 
                        "startTime": startStamp.getTime(),
                        "userName" : config.provider.user 
                      }
                      $data.JayService.createAdapter(
                        serviceType, 
                        function() {
                          return new serviceType(config.provider);
                        }
                      ).call(
                          self, 
                          req, 
                          res, 
                          function(err) {
                            if (typeof err === 'string') err = new Error(err);
                            errorHandlerFn(err, req, res, next);
                          }
                          
                      );
                      postProcessFn(req, res);

                  });
                });
              });
            });
        }
    };
};

$data.createODataServer = function(type, path, port, host, protocol, indexLocation, certificates){
console.log("");
console.log("Starting RESO API OData server");
console.log("");

  var config = typeof type === 'object' ? type : {};

//
// create listener 
//
  var connect = require('connect');
  var app;
  if (protocol == "http" ) {
    app = connect();
  } else {
    var serverCertificates = config.certificates || certificates;
    app = connect(serverCertificates);
  }
  var serverPath = config.path || path || "/";
  var serverIndexLocation = config.indexLocation || indexLocation || "./repository";

  if (config.compression) {
    app.use(connect.compress());
  }

  app.use(serverPath, $data.ODataServer(type, serverIndexLocation));
  var serverHost = config.host || host;
  var serverPort = config.port || port || 80;
  var serverProtocol = config.protocol || protocol || "http";
  app.listen(serverPort, serverHost);
console.log("Listening on " + serverProtocol + "://" + serverHost + ":" + serverPort + serverPath);

//
// authentication
//
  switch(config.authType) {
    case "Basic":
console.log("Supports " + config.authType + " Authentication");
      break;
    case "Digest":
console.log("Supports " + config.authType + " Authentication");
console.log("- Digest realm: " + config.authRealm);
console.log("- Digest nonce: " + nonce);
      break;
    default:
console.log("No Authentication is being used");
  }

//
// authentication
//
  if (config.compression) {
console.log("Output will ALWAYS be compressed if the requestor can handle compression");
  } else {
console.log("Output will NEVER be compressed");
  }
//
// indexing 
//
  var Db = require('mongodb').Db , Server = require('mongodb').Server;
  var db = new Db("reso", new Server("127.0.0.1", 27017), { safe : false } );
  db.open(function(err, db) {
    if (err) throw err;
    var collection = db.collection("Property");
    if (config.externalIndex) {
console.log("Uniqueness enforced with external index file: " + serverIndexLocation);
console.log("- Looking for built-in elements that cause problems for the external index.");
//      collection.dropIndex({"ListingId":1}, function(err, result) {
      db.dropIndex("Property", {"ListingId":1}, function(err, result) {
        if (err) {
console.log("- No issues encountered");
        } else {
console.log("- Built-in index dropped");
        }
        db.close();
console.log("");
      }); // collection.dropIndex
    } else {
console.log("Uniqueness enforced with built-in index");
//      collection.ensureIndex({"ListingId":1}, {unique:true, background:true, dropDups:true, w:1}, function(err, indexName) {
//      collection.ensureIndex({"ListingId":1}, {unique:true, background:true, dropDups:true, w:0}, function(err, indexName) {
//      db.ensureIndex("Property", {"ListingId":1}, {unique:true, background:true, dropDups:true, w:1}, function(err, indexName) {
      db.ensureIndex("Property", {"ListingId":1}, {unique:true, background:true, dropDups:true, w:0}, function(err, indexName) {
        if (err) throw err;
        if (!indexName) {
console.log("- Built-in index was not found and was automatically created");
        }
// Fetch full index information
//        collection.indexInformation({full:true}, function(err, indexInformation) {
      db.indexInformation("Property", {full:true}, function(err, indexInformation) {
//console.dir(indexInformation);
          for (var i in indexInformation) {
            var anIndex = indexInformation[i];
            if (anIndex.name != "_id_") {
console.log("- Built-in index name: " + anIndex.name);
            }
          }
          db.close();
console.log("");
        });
      }); // collection.ensureIndex
    }
  }); // db.open

};

module.exports = exports = $data.ODataServer;

function digestAuth(callback, req, res, realm, next) {
  var authorization = req.headers.authorization;

  if (req.user) return next();
  if (!authorization) return unauthorizedDigest(res, realm);

//
// Determine if Digest authorization header is sent
//
//console.log(authorization);
  var parts = authorization.split(" ");
  if (parts[0] !== "Digest") {
    return unauthorizedDigest(res, realm);
  }

//
// determine if the correct number of arguments is in the Digest header
//
  var pos = authorization.indexOf(" ");
  authorization = authorization.substring(pos);
  var parts = authorization.split(",");
  if (parts.length !== 8) {
    return unauthorizedDigest(res, realm);
  }

//
// breakdown the header
//
  var username;
  var realm;
  var nonce;
  var uri;
  var response;
  var qop;
  var nc;
  var cnonce; 
  var length = parts.length;   
  for (var i = 0; i < length; i++) {
    var pieces = parts[i].split("=");
    switch(pieces[0].trim()) {
      case "username":
        username = pieces[1].replace(/["']/g, "");
        break;
      case "realm":
        realm = pieces[1].replace(/["']/g, "");
        break;
      case "nonce":
        nonce = pieces[1].replace(/["']/g, "");
        break;
      case "uri":
        uri = pieces[1].replace(/["']/g, "");
        break;
      case "response":
        response = pieces[1].replace(/["']/g, "");
        break;
      case "qop":
        qop = pieces[1].replace(/["']/g, "");
        break;
      case "nc":
        nc = pieces[1].replace(/["']/g, "");
        break;
      case "cnonce":
        cnonce = pieces[1].replace(/["']/g, "");
        break;
    }
  }

//
// use the callback to determine the password to use
//
  var password = callback(username);
//console.log("PASSWORD: " + password);

//
// construct a response
//
//  var A1 = username + ":" + realm + ":" + password;
//  var HA1 = md5(A1);
//  var A2 = req.method + ":" + uri;
//  var HA2 = md5(A2);

  var HA1 = md5(username + ":" + realm + ":" + password);
  var HA2 = md5(req.method + ":" + uri);
  var check_response = md5(HA1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + HA2);

//
// check constructed response against the passed response
//
//console.log(check_response);
//console.log(response);
  if (check_response != response) {
console.log("FAILED");
    unauthorizedDigest(res, realm);
  }

//
// set the user in the request
// 
  req.user = req.remoteUser = username;

//
// move on
//
  next();
};

function unauthorizedDigest(res, realm) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Digest realm="' + realm + '", nonce="' + nonce + '", qop=auth');
  res.end("Unauthorized");
};

function md5(str, encoding){
  return crypto
    .createHash('md5')
    .update(str, 'utf8')
    .digest(encoding || 'hex');
};

function readIndexFile(fileName) {
  if (fs.existsSync(fileName)) {
    var contents = fs.readFileSync(fileName).toString();
    return contents.split(",");
  }
  return new Array();
}
