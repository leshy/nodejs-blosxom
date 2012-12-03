(function() {
  var async, comm, converter, createPost, crypto, decorate, decorators, deletePost, ejslocals, env, express, fs, getPosts, helpers, hound, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, logger, makeLogDecorator, mongodb, pagedown, path, settings, updatePost, watchDir, wraplog, _;
  var __slice = Array.prototype.slice;
  path = require('path');
  fs = require('fs');
  crypto = require('crypto');
  async = require('async');
  _ = require('underscore');
  mongodb = require('mongodb');
  http = require('http');
  express = require('express');
  ejslocals = require('ejs-locals');
  logger = require('logger');
  comm = require('comm/serverside');
  helpers = require('helpers');
  decorators = require('decorators');
  decorate = decorators.decorate;
  hound = require('hound');
  pagedown = require('pagedown');
  converter = pagedown.getSanitizingConverter();
  env = {};
  settings = {
    postsfolder: "posts"
  };
  ejslocals.ejs.filters.prettyDate = function(obj) {
    return helpers.prettyDate(obj);
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
    env.blog = new comm.MongoCollectionNode({
      db: env.db,
      collection: 'blog'
    });
    env.post = env.blog.defineModel('post', {
      output: function() {
        return {
          id: this.attributes.id,
          time: this.attributes.created,
          tags: ['some', 'tag'],
          title: this.attributes.title,
          body: converter.makeHtml(this.attributes.body)
        };
      }
    });
    return callback();
  };
  initExpress = function(callback) {
    var app;
    env.app = app = express();
    app.configure(function() {
      app.engine('ejs', ejslocals.render);
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
  watchDir = function(callback) {
    var watcher;
    watcher = hound.watch(settings.postsfolder);
    watcher.on("create", function(f, stat) {
      if (stat.isFile()) {
        env.log('created file ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'create');
        return createPost(f);
      } else {
        return env.log('created dir ' + f, {
          file: f
        }, 'info', 'fs', 'dir', 'create');
      }
    });
    watcher.on("change", function(f, stat) {
      env.log('file changed ' + f, {
        file: f
      }, 'info', 'fs', 'file', 'change');
      return updatePost(f);
    });
    watcher.on("delete", function(f, stat) {
      env.log('deleted file ' + f, {
        file: f
      }, 'info', 'fs', 'file', 'delete');
      return deletePost(f);
    });
    return callback();
  };
  deletePost = decorate(decorators.MakeDecorator_Throttle({
    timeout: 200
  }), function(file, callback) {
    return env.blog.findModels({
      file: file
    }, {}, function(post) {
      if (post) {
        return post.remove();
      } else {
        return helpers.cbc(callback);
      }
    });
  });
  updatePost = decorate(decorators.MakeDecorator_Throttle({
    timeout: 200
  }), function(file, id, callback) {
    var data;
    try {
      data = fs.readFileSync(file, 'ascii');
    } catch (error) {
      helpers.cbc(callback, error);
    }
    return env.blog.findModels({
      file: file
    }, {}, function(post) {
      if (post) {
        post.set({
          body: data
        });
        return post.flush();
      } else {
        return helpers.cbc(callback);
      }
    });
  });
  createPost = decorate(decorators.MakeDecorator_Throttle({
    timeout: 200
  }), function(file, id, callback) {
    var data, post, stat;
    try {
      stat = fs.statSync(file);
      data = fs.readFileSync(file, 'ascii');
    } catch (error) {
      helpers.cbc(callback, error);
    }
    post = new env.blog.models.post({
      created: stat.ctime.getTime(),
      modified: stat.ctime.getTime(),
      file: file,
      title: file.replace(/_/g, ' '),
      body: data
    });
    return post.flush(function() {
      return helpers.cbc(callback);
    });
  });
  getPosts = function(search, callback) {
    return env.blog.findModels(search, {}, callback);
  };
  initRoutes = function(callback) {
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'hello there'
      });
    });
    env.app.get('/blog', function(req, res) {
      var posts, serve;
      serve = function(posts) {
        return res.render('blog', {
          title: 'blog',
          posts: posts,
          helpers: helpers
        });
      };
      posts = [];
      return getPosts({}, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          return serve(posts);
        }
      });
    });
    env.app.get('/posts', function(req, res) {
      return getPosts({}, function(post) {
        if (post) {
          console.log('sending', post.attributes);
          return res.write(JSON.stringify(post.output()) + "\n");
        } else {
          return res.end();
        }
      });
    });
    return callback();
  };
  init = function(callback) {
    return async.auto({
      logger: initLogger,
      database: ['logger', wraplog('database', initDb)],
      collections: ['database', wraplog('collections', initCollections)],
      express: ['database', 'logger', wraplog('express', initExpress)],
      routes: ['express', wraplog('routes', initRoutes)],
      watchDir: ['collections', wraplog('watchDir', watchDir)]
    }, callback);
  };
  init(function() {
    return env.log('system initialized', {}, 'info', 'init', 'done');
  });
}).call(this);
