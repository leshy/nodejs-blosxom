(function() {
  var async, crawlFiles, crypto, decorate, decorators, engine, env, express, fs, getPosts, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, logger, makeLogDecorator, mongodb, refreshFiles, settings, wraplog;
  var __slice = Array.prototype.slice;
  fs = require('fs');
  crypto = require('crypto');
  async = require('async');
  logger = require('logger');
  mongodb = require('mongodb');
  http = require('http');
  express = require('express');
  engine = require('ejs-locals');
  decorators = require('decorators');
  decorate = decorators.decorate;
  env = {};
  settings = {
    postsfolder: "posts/"
  };
  initLogger = function(callback) {
    env.logger = new logger.logger();
    env.consoleLogger = new logger.consoleLogger();
    env.logger.pass();
    env.logger.connect(env.consoleLogger);
    env.log = env.logger.log.bind(env.logger);
    env.log('logger initialized', {}, 'init', 'info');
    return callback();
  };
  initDb = function(callback) {
    env.db = new mongodb.Db('blog', new mongodb.Server('localhost', 27017), {
      safe: true
    });
    return env.db.open(callback);
  };
  initCollections = function(callback) {
    return env.blog = env.db.collection('blog', callback);
  };
  initExpress = function(callback) {
    var app;
    env.app = app = express();
    app.configure(function() {
      app.engine('ejs', engine);
      app.set('view engine', 'ejs');
      app.set('views', __dirname + '/views');
      app.use(express.favicon());
      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(app.router);
      app.use(express.static(__dirname + '/static'));
      return app.use(function(err, req, res, next) {
        env.log('web request error', {
          stack: err.stack
        }, 'error', 'http');
        return res.send(500, 'BOOOM!');
      });
    });
    env.server = http.createServer(env.app);
    env.server.listen(3333);
    env.log('http server listening', {}, 'info', 'init', 'http');
    return callback(void 0, true);
  };
  initRoutes = function(callback) {
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'hello there'
      });
    });
    return callback();
  };
  makeLogDecorator = function(name) {
    return function() {
      var args, callback, f;
      f = arguments[0], callback = arguments[1], args = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      return f(function(err, data) {
        if (!err) {
          env.log(name + ' ready', {}, 'info', 'init', 'done', name);
        } else {
          env.log(name + ' failed!', {}, 'info', 'init', 'error', name);
        }
        return callback(err, data);
      });
    };
  };
  wraplog = function(name, f) {
    return decorators.decorate(makeLogDecorator(name), f);
  };
  crawlFiles = function(folder, callback) {};
  refreshFiles = function(callback) {
    var shasum;
    shasum = function(filename, callback) {
      var hash, s;
      s = fs.ReadStream(filename);
      hash = crypto.createHash('sha1');
      s.on('data', function(d) {
        return hash.update(d);
      });
      return s.on('end', function() {
        return callback(void 0, hash.digest('hex'));
      });
    };
    return callback();
  };
  getPosts = function(search, callback) {
    return callback();
  };
  init = function(callback) {
    return async.auto({
      logger: initLogger,
      database: ['logger', wraplog('database', initDb)],
      collections: ['database', wraplog('collections', initCollections)],
      express: ['database', 'logger', wraplog('express', initExpress)],
      routes: ['express', wraplog('routes', initRoutes)],
      refreshFiles: ['collections', wraplog('refreshFiles', refreshFiles)]
    }, callback);
  };
  init(function() {
    return env.log('system initialized', {}, 'info', 'init', 'done');
  });
}).call(this);
