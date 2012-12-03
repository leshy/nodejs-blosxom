path = require 'path'
fs = require 'fs'
crypto = require 'crypto'
async = require 'async'
_ = require 'underscore'

mongodb = require 'mongodb'
http = require 'http'
express = require 'express'
engine = require 'ejs-locals'


logger = require 'logger'
comm = require 'comm/serverside'

decorators = require 'decorators'
decorate = decorators.decorate

hound = require 'hound'

env = {}

settings = postsfolder: "posts"

initLogger = (callback) ->
    env.logger = new logger.logger()
    env.consoleLogger = new logger.consoleLogger()
    env.logger.pass()
    env.logger.connect(env.consoleLogger)
    env.log = env.logger.log.bind(env.logger)
    env.log('logger initialized', {}, 'init','info')
    callback()

initDb = (callback) ->
    env.db = new mongodb.Db 'blog', new mongodb.Server('localhost', 27017), safe: true
    env.db.open callback

initCollections = (callback) ->
    env.blog = env.db.collection('blog',callback)

initExpress = (callback) ->
    env.app = app = express()
            
    app.configure ->
        app.engine 'ejs', engine
        app.set 'view engine', 'ejs'
        app.set 'views', __dirname + '/views'
        app.use express.favicon()
        app.use express.logger('dev')
        app.use express.bodyParser()
        app.use express.methodOverride()
        app.use app.router
        app.use express.static(__dirname + '/static')
        app.use (err, req, res, next) ->
            env.log 'web request error', { stack: err.stack }, 'error', 'http'
            res.send 500, 'BOOOM!'

    env.server = http.createServer env.app
    env.server.listen 3333
    env.log 'http server listening', {}, 'info', 'init', 'http'
    callback undefined, true

initRoutes = (callback) ->
    env.app.get '/', (req,res) ->
      res.render 'index', { title: 'hello there' }
        
    callback()


makeLogDecorator = (name) -> 
    (f,callback,args...) ->
        f (err,data) ->
            if not err
                env.log(name + ' ready', {}, 'info', 'init', 'done', name)
            else
                env.log(name + ' failed!', {}, 'info', 'init', 'error', name)
            callback(err,data)

wraplog = (name,f) -> decorators.decorate makeLogDecorator(name), f


watchDir = (callback) -> 
    console.log(__dirname + '/' + settings.postsfolder)
    watcher = hound.watch(__dirname + '/' + settings.postsfolder)

    watcher.on "create", (f,stat) ->
        if stat.isFile()
            env.log('created file ' + f, { file: f }, 'info', 'fs', 'file', 'create')
            createPost(f)
        else
            env.log('created dir ' + f, { file: f }, 'info', 'fs', 'dir', 'create')
            
    watcher.on "change", (f,stat) ->
        env.log('file changed ' + f, { file: f }, 'info', 'fs', 'file', 'change')
        updatePost(f)
        
    watcher.on "delete", (f,stat) ->
        if stat.isFile()
            env.log('deleted file ' + f, { file: f }, 'info', 'fs', 'file', 'delete')
            deletePost(f)
        else
            env.log('deleted dir ' + f, { file: f }, 'info', 'fs', 'dir', 'delete')
        
    callback()


deleteFolder = decorate( decorators.MakeDecorator_Throttle({timeout: 200}), (file, id, callback) ->
#    console.log 'delfolder:'.red, file
    if callback then callback()
)

deletePost = decorate( decorators.MakeDecorator_Throttle({timeout: 200}), (file, id, callback) ->
#    console.log 'delpost:'.red, file
    if callback then callback()
)

updatePost = decorate( decorators.MakeDecorator_Throttle({timeout: 200}), (file, id, callback) ->
#    console.log 'updatepost:'.red, file
    if callback then callback()
)

getPost = (file) ->
    true
        
getPosts = (search,callback) ->        
    callback()

init = (callback) ->
    async.auto        
        logger: initLogger
        database: [ 'logger', wraplog('database', initDb) ]
        collections: [ 'database', wraplog('collections', initCollections) ]
        express: [ 'database', 'logger', wraplog('express',initExpress) ]
        routes: [ 'express', wraplog('routes',initRoutes) ]
        watchDir: [ 'collections', wraplog('watchDir', watchDir) ]
        callback

init ->
    env.log 'system initialized',{}, 'info','init','done'


