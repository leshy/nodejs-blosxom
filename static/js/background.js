

$(window).bind('resize', function() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 200);
});

$(document).ready(start);

function resize() {
    maincanvas = $("canvas")[0];
    maincanvas.width = $(document).width() - 5;
    maincanvas.height = $(document).height() - 5;
}

function RandomFloat(x) { return Math.random() * x }
function RandomInt(x) { return Math.round(RandomFloat(x)) }
function RandomBool() { return Boolean(RandomInt(1)) }
function RandomSign() { return  (RandomBool()) ? 1 : -1 }
function RandomWalk(x,diff) { return x + (RandomSign() * RandomInt(diff))  }
function RandomWalkFloat(x,diff) { return x + (RandomSign() * RandomFloat(diff))  }
function RandomGauss() { return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * pi * Math.random()) }

function RandomWalkFloatGaussian(x,target,diff) { 
    var distance = x - point
    // need bell curve distribution

 }

var pi = 3.14159265

var Object = Backbone.Model.extend({
    defaults: { direction: undefined, x: undefined, y: undefined, size: undefined, speed: 1 },
    initialize: function() {
        if (!this.get('direction')) { this.set({direction: RandomFloat(2 * pi) }) }
        if (!this.get('size')) { this.set({size: 3 + RandomFloat(7) }) }
        //if (!this.get('speed')) { this.set({speed: 0.3 + RandomFloat(1.7) }) }
    },

    move: function(angle,distance) {
        if (this.get('size') < 0.03) { return false }
        var c = distance
        var a = c * Math.sin(angle) 
        var b = c * Math.cos(angle)
        this.set({x : this.get('x') + b, y : this.get('y') + a})
        this.set({size: this.get('size') - RandomFloat(0.02)})
        return true
    },
    
    randomjump: function() {
        this.move(this.get('direction'),100 + RandomInt(100))
    },

    tick: function() {
        //this.set({speed: RandomWalkFloat(this.get('speed'),0.2)})
        this.set({speed: 0.5 + (1.0 / this.get('size')) })
        this.set({direction: RandomWalkFloat(this.get('direction'),(2 * pi) / (50 / this.get('speed')))})

        return this.move(this.get('direction'),this.get('speed'))
    },

    clone: function() {
        //this.set({size : this.get('size') / 1.3 } )
        return new Object({ direction: this.get('direction'), x: this.get('x'), y: this.get('y'), size: this.get('size'), speed: this.get('speed') })
    },

    draw: function(ctx) {
        ctx.fillStyle = "rgba(0, 0, 0, " + (0.2 * (this.get('speed') * 0.9 )) + ")";  
        ctx.beginPath();
        ctx.arc(this.get('x'), this.get('y'), this.get('size'), 0, Math.PI*2, true); 
        ctx.closePath();
        ctx.fill();
    }
})



function start() {
    canvas = $("canvas")[0];
    resize()
    var ctx = canvas.getContext('2d');
    var x =  $(document).width() / 2
    var y =  300

    objects = []
    _.times(13, function() { objects.push(new Object({ x: x, y: y })) })
 
    _.map(objects,function(obj) { obj.randomjump() })
    
    var health = 50

    function randomwalk() {
        var newobjects = []
        var starttime = new Date().getTime();

        objects = _.filter(objects, function(obj) {
            if (objects.length < 100) {
                if (RandomInt(200) == 5) {
                    newobjects.push(obj.clone())
                }
            }

            var state = obj.tick()
            obj.draw(ctx)
            return state
        })

        objects = _.union(objects,newobjects)
        ctx.save()

        // health is used to calculate render times and give up on slow machines to avoid being annoying.
        health = health - (new Date().getTime() - starttime )
        if (health < 100) { health += ( objects.length); if (health > 100) { health = 100 } }
        if (objects.length && (health > 0)) { setTimeout(randomwalk,15) } else { console.log('done') }
    }

    randomwalk()
}


var resizeTimer = null;
