(function() {
  var CreateOrUpdate, FindPost, ReadPostFile, async, comm, converter, crypto, decorate, decorators, deletePost, ejslocals, env, express, fs, getPosts, helpers, hound, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, logger, makeLogDecorator, mongodb, pagedown, parseJSON, path, settings, watchDir, wraplog, _;
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
  converter = new pagedown.Converter();
  env = {};
  settings = {
    postsfolder: "posts"
  };
  ejslocals.ejs.filters.prettyDate = function(obj) {
    return helpers.prettyDate2(obj);
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
          created: this.attributes.created,
          modified: this.attributes.modified,
          tags: _.keys(this.attributes.tags),
          title: this.attributes.title,
          link: this.attributes.file,
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
        return ReadPostFile(f);
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
      return ReadPostFile(f);
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
  parseJSON = function(data) {
    var extraopts, match;
    match = data.match(/^(.*)\n/);
    if (match) {
      match = match[1];
    } else {
      return {
        data: data,
        extraopts: {}
      };
    }
    try {
      extraopts = eval("x=" + match);
      return {
        data: data.replace(/^.*\n/, ''),
        extraopts: extraopts
      };
    } catch (error) {
      console.log(error);
      return {
        data: data,
        extraopts: {}
      };
    }
  };
  FindPost = function(file, callback) {
    return env.blog.findModels({
      file: file
    }, {}, function(post) {
      var found;
      if (post) {
        found = true;
        if (!found) {
          return callback(void 0, post);
        }
      } else {
        if (!found) {
          return callback("not found");
        }
      }
    });
  };
  CreateOrUpdate = function(data, callback) {
    return FindPost(data.file, function(err, post) {
      if (post) {
        post.set(data);
      } else {
        post = new env.blog.models.post(data);
      }
      return post.flush(function() {
        return helpers.cbc(callback);
      });
    });
  };
  ReadPostFile = decorate(decorators.MakeDecorator_Throttle({
    timeout: 200
  }), function(file, id, callback) {
    var data, extraopts, options, parsed, pathtags, stat, tags, title;
    try {
      stat = fs.statSync(file);
      data = fs.readFileSync(file, 'ascii');
      parsed = parseJSON(data);
      data = parsed.data;
      extraopts = parsed.extraopts;
    } catch (error) {
      helpers.cbc(callback, error);
    }
    title = path.basename(file, path.extname(file));
    options = {
      created: stat.ctime.getTime(),
      modified: stat.mtime.getTime(),
      file: file,
      link: file,
      title: title.replace(/_/g, ' '),
      body: data,
      tags: []
    };
    options = _.extend(options, extraopts);
    pathtags = file.split('/');
    pathtags.pop();
    tags = {};
    _.map(pathtags.concat(options.tags), function(tag) {
      return tags[tag] = true;
    });
    options.tags = tags;
    return CreateOrUpdate(options);
  });
  getPosts = function(search, callback) {
    return env.blog.findModels(search, {
      sort: {
        created: -1
      }
    }, callback);
  };
  initRoutes = function(callback) {
    var serveposts;
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'lesh.sysphere.org'
      });
    });
    serveposts = function(posts, res) {
      return res.render('blog', {
        title: 'blog',
        posts: posts,
        helpers: helpers
      });
    };
    env.app.get('/blog', function(req, res) {
      var posts;
      posts = [];
      return getPosts({}, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          return serveposts(posts, res);
        }
      });
    });
    env.app.get('/blog/get/*', function(req, res) {
      var posts, serve;
      serve = function(posts) {
        return res.render('blog', {
          title: 'blog',
          posts: posts,
          helpers: helpers
        });
      };
      posts = [];
      console.log('looking for', {
        file: req.params[0]
      });
      return getPosts({
        file: req.params[0]
      }, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          if (posts.length) {
            return serveposts(posts, res);
          } else {
            return res.end('404');
          }
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
