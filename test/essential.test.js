'use strict';

var assert = require('assert')
var Cot = require('cot');
var config = require('./config');
var Q = require('q');
var AutoView = require('../couchdb-auto-views').AutoView

describe('AutoView', function() {   
    var cot = new Cot(config.serverOpts);
    var db = cot.db(config.dbName);
    
    beforeEach(function(done) {
        cot.jsonRequest('DELETE', '/' + config.dbName)
        .then(function() {
            return cot.jsonRequest('PUT', '/' + config.dbName);
        })
        .then(function() {
            var docPromises = [];
            for (var i = 1; i < 10; i++) {
                docPromises.push(db.post({
                    _id: 'doc-' + i,
                    key: 'key-' + i,
                    even: (i % 2) == 0 ? true : false
                }));
            }
            
            return Q.all(docPromises);
        })
        .nodeify(done);
    });

    it('should generate a design doc if none exists', function(done) {
        var view = new AutoView(db, ['key'])
        var viewRev;

        view.query().exec()
        .then(function(rows) {
            return db.get('_design/key')
        })
        .then(function(doc) {
            viewRev = doc._rev
            return view.query().exec()
        })
        .then(function(rows) {
            return db.get('_design/key')
        })
        .then(function(doc) {
            assert.equal(doc._rev, viewRev)
        })
        .nodeify(done)
    });

    it('should return all 9 docs in order', function(done) {
        new AutoView(db, ['key']).query().exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 9)
            for (var i = 1; i < 10; i++) {
                assert.equal(rows[i-1].id, 'doc-' + i)
                assert.equal(rows[i-1].key, 'key-' + i)
            }
        })
        .nodeify(done)
    });

    it('should return all 9 docs in reverse order', function(done) {
        new AutoView(db, ['key']).query().reverse().exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 9)
            for (var i = 1; i < 10; i++) {
                assert.equal(rows[i-1].id, 'doc-' + (10-i))
                assert.equal(rows[i-1].key, 'key-' + (10-i))
            }
        })
        .nodeify(done)
    });

    it('should return doc-2', function(done) {
        new AutoView(db, ['key']).query().key(['key-2']).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 1)
            assert.equal(rows[0].id, 'doc-2')
        })
        .nodeify(done)
    });

    it('should return doc-2, doc-3, and doc-4', function(done) {
        new AutoView(db, ['key']).query().range(['key-2'], ['key-4']).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 3)
            assert.equal(rows[0].id, 'doc-2')
            assert.equal(rows[1].id, 'doc-3')
            assert.equal(rows[2].id, 'doc-4')
        })
        .nodeify(done)
    });

    it('should return doc-2 and doc-3', function(done) {
        new AutoView(db, ['key']).query().range(['key-2'], ['key-4'], true).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 2)
            assert.equal(rows[0].id, 'doc-2')
            assert.equal(rows[1].id, 'doc-3')
        })
        .nodeify(done)
    });

    it('should return doc-2', function(done) {
        new AutoView(db, ['key']).query().range(['key-2'], ['key-2']).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 1)
            assert.equal(rows[0].id, 'doc-2')
        })
        .nodeify(done)
    });

    it('should return no rows', function(done) {
        new AutoView(db, ['key']).query().range(['key-2'], ['key-2'], true).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 0)
        })
        .nodeify(done)
    });

    it('should return even docs', function(done) {
        new AutoView(db, ['even', 'key']).query().prefix([true]).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 4)
            assert.equal(rows[0].id, 'doc-2')
            assert.equal(rows[1].id, 'doc-4')
            assert.equal(rows[2].id, 'doc-6')
            assert.equal(rows[3].id, 'doc-8')
        })
        .nodeify(done)
    });

    it('should return odd docs', function(done) {
        new AutoView(db, ['even', 'key']).query().prefix([false]).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 5)
            assert.equal(rows[0].id, 'doc-1')
            assert.equal(rows[1].id, 'doc-3')
            assert.equal(rows[2].id, 'doc-5')
            assert.equal(rows[3].id, 'doc-7')
            assert.equal(rows[4].id, 'doc-9')
        })
        .nodeify(done)
    });

    it('should return odd docs in reverse order', function(done) {
        new AutoView(db, ['even', 'key']).query().prefix([false]).reverse().exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 5)
            assert.equal(rows[0].id, 'doc-9')
            assert.equal(rows[1].id, 'doc-7')
            assert.equal(rows[2].id, 'doc-5')
            assert.equal(rows[3].id, 'doc-3')
            assert.equal(rows[4].id, 'doc-1')
        })
        .nodeify(done)
    });

    it('should count 5 docs', function(done) {
        new AutoView(db, ['even', 'key'], {reduce: 'count'}).query().prefix([false]).reduce().exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 1)
            assert.equal(rows[0].value, 5)
        })
        .nodeify(done)
    })

    it('should group even and odd docs and count them', function(done) {
        new AutoView(db, ['even', 'key'], {reduce: 'count'}).query().group(1).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 2)
            assert.equal(rows[0].value, 5)
            assert.equal(rows[1].value, 4)
        })
        .nodeify(done)
    })

    it('should return the first two docs', function(done) {
        new AutoView(db, ['key']).query().page(2).exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 2)
            assert.equal(rows[0].id, 'doc-1')
            assert.equal(rows[1].id, 'doc-2')
        })
        .nodeify(done)
    })

    it('should return the second two docs', function(done) {
        new AutoView(db, ['key']).query().page(2, ['key-2'], 'doc-2').exec()
        .then(function(rows) {
            assert.ok(Array.isArray(rows))
            assert.equal(rows.length, 2)
            assert.equal(rows[0].id, 'doc-3')
            assert.equal(rows[1].id, 'doc-4')
        })
        .nodeify(done)
    })

    it('should page through several docs with the same key', function(done) {
        var promises = []
        for (var i = 10; i < 13; i++) {
            promises.push(db.post({_id: 'doc-' + i, key: 'key-2'}))
        }

        var docsToSee = {
            'doc-1': true,
            'doc-2': true,
            'doc-10': true,
            'doc-11': true,
            'doc-12': true,
            'doc-3': true
        }

        function sawDoc(id) {
            if (!docsToSee[id]) {
                throw new Error('did not expect to see ' + id)
            }
            delete docsToSee[id]
        }

        var query = new AutoView(db, ['key']).query()

        Q.all(promises)
        .then(function() {
            return query.page(2).exec()
        })
        .then(function(rows) {
            assert.equal(rows.length, 2)
            assert.equal(rows[0].id, 'doc-1')
            sawDoc(rows[0].id)
            sawDoc(rows[1].id)

            return query.page(2, rows[1].key, rows[1].id).exec()
        })
        .then(function(rows) {
            assert.equal(rows.length, 2)
            sawDoc(rows[0].id)
            sawDoc(rows[1].id)

            return query.page(2, rows[1].key, rows[1].id).exec()
        })
        .then(function(rows) {
            assert.equal(rows.length, 2)
            assert.equal(rows[1].id, 'doc-3')
            sawDoc(rows[0].id)
            sawDoc(rows[1].id)
            assert.equal(Object.keys(docsToSee).length, 0)
        })
        .nodeify(done)
    })
});
