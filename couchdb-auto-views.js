/*
Copyright (c) 2013 Will Conant, http://willconant.com/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

'use strict'

exports.View = View
exports.AutoView = AutoView

function View(db, designName, viewName) {
    this.db = db
    this.designName = designName
    this.viewName = viewName
}

View.prototype.query = function() {
    return new VQ(this)
}

View.prototype._query = function(query) {
    return this.db.view(this.designName, this.viewName, query)
}

function AutoView(db, key, opts) {
    this.db = db

    opts = opts || {}

    var fieldRe = /^[a-zA-Z_]\w*$/

    if (opts.each) {
        if (!fieldRe.test(opts.each)) {
            throw new Error('invalid field name for each: ' + opts.each)
        }
        this.each = opts.each

        fieldRe = /^\.?[a-zA-Z_]\w*$/
    }

    if (!Array.isArray(key)) {
        throw new Error('key must be an array')
    }

    key.forEach(function(field) {
        if (!fieldRe.test(field)) {
            throw new Error('invalid field name in key: ' + field)
        }
    })

    this.key = key.slice()

    if (opts.value) {
        if (!fieldRe.test(opts.value)) {
            throw new Error('invalid field name for value: ' + opts.value)
        }
        this.value = opts.value
    }

    if (opts.reduce) {
        if (opts.reduce !== 'sum' && opts.reduce !== 'count' && opts.reduce !== 'stats') {
            throw new Error('reduce must be one of sum, count, or stats')
        }
        this.reduce = '_' + opts.reduce
    }

    var nameArray = [this.key.join('-')]
    if (this.reduce) {
        nameArray[1] = this.reduce.substr(1) // don't include the underscore
    }
    if (this.value) {
        nameArray[2] = this.value
    }
    if (this.each) {
        nameArray[3] = this.each
    }

    this.viewName = nameArray.join('--')
}

AutoView.prototype.map = function() {
    var source = 'function(doc) { '
    if (this.each) {
        source += 'if (!Array.isArray(doc.' + this.each + ')) {return;} '
        source += 'doc.' + this.each + '.forEach(function(x) { '
    }

    source += 'var k = []; '
    this.key.forEach(function(field) {
        field = field.substr(0, 1) === '.' ? ('x' + field) : 'doc.' + field
        source += 'if (typeof ' + field + ' === "undefined") {return;} '
        source += 'k.push(' + field + '); '
    })

    source += 'var v = '
    if (this.value) {
        if (this.value.substr(0, 1) === '.') {
            source += 'x' + this.value
        } else {
            source += 'doc.' + this.value
        }
    } else {
        source += 'null'
    }
    source += '; emit(k, v); '

    if (this.each) {
        source += '}); '
    }

    source += '}'

    return source
}

AutoView.prototype.query = function() {
    return new VQ(this)
}

AutoView.prototype._query = function(query) {
    var self = this

    return self.db.view(self.viewName, self.viewName, query)
    .then(null, function(err) {
        if (!err.message.match(/"error":"not_found"/)) {
            throw err;
        }
        var designDoc = {
            _id: '_design/' + self.viewName,
            views: {}
        }
        designDoc.views[self.viewName] = {
            map: self.map(),
            reduce: self.reduce
        }
        return self.db.put(designDoc)
        .then(function() {
            return self.db.view(self.viewName, self.viewName, query)
        })
    })
}

function VQ(view, query) {
    this.view = view
    this.query = query || {reduce: false, include_docs: true}
    this.refinement = 0
}

VQ.prototype.copy = function() {
    var thisQuery = this.query
    var newQuery = {}
    Object.keys(thisQuery).forEach(function(key) {
        newQuery[key] = thisQuery[key]
    })
    return new VQ(this.view, newQuery)
}

VQ.prototype.key = function(key) {
    if (this.refinement >= 1) {
        throw new Error('key cannot follow key, range, prefix, reverse, page, noDocs, group, or reduce')   
    }
    var copy = this.copy()
    copy.query.key = key.slice()
    copy.refinement = 1
    return copy
}

VQ.prototype.range = function(start, end, excludeEnd) {
    if (this.refinement >= 1) {
        throw new Error('range cannot follow key, range, prefix, reverse, page, noDocs, group, or reduce')   
    }
    var copy = this.copy()
    copy.query.startkey = start.slice()
    copy.query.endkey = end.slice()
    if (excludeEnd) copy.query.inclusive_end = false
    copy.refinement = 1
    return copy
}

VQ.prototype.prefix = function(prefix) {
    if (this.refinement >= 1) {
        throw new Error('prefix cannot follow key, range, prefix, reverse, page, noDocs, group, or reduce')   
    }
    var copy = this.copy()
    copy.query.startkey = prefix.slice()
    copy.query.endkey = prefix.concat({})
    copy.refinement = 1
    return copy
}

VQ.prototype.reverse = function() {
    if (this.refinement >= 2) {
        throw new Error('reverse cannot follow reverse, page, noDocs, group, or reduce')
    }
    var copy = this.copy()
    copy.query.descending = true
    copy.query.startkey = this.query.endkey
    copy.query.endkey = this.query.startkey
    copy.refinement = 2
    return copy
}

VQ.prototype.page = function(limit, lastKey, lastDocId) {
    if (this.refinement >= 3) {
        throw new Error('page cannot follow page, noDocs, group, or reduce')
    }
    var copy = this.copy()
    copy.query.limit = limit
    if (lastKey) {
        copy.query.startkey = lastKey
        copy.query.startkey_docid = lastDocId
        copy.query.skip = 1
    }
    copy.refinement = 3
    return copy
}

VQ.prototype.noDocs = function() {
    if (this.refinement >= 4) {
        throw new Error('noDocs cannot follow noDocs, group, or reduce')
    }
    var copy = this.copy()
    delete copy.query.include_docs
    copy.refinement = 4
    return copy
}

VQ.prototype.group = function(level) {
    if (this.refinement >= 4 || this.query.descending || this.query.limit) {
        throw new Error('group cannot follow reverse, page, noDocs, group, or reduce')
    }
    var copy = this.copy()
    if (!level) {
        copy.query.group = true
    }
    else {
        copy.query.group_level = level
    }
    copy.query.reduce = true
    delete copy.query.include_docs
    copy.refinement = 4
    return copy
}

VQ.prototype.reduce = function() {
    if (this.refinement >= 4 || this.query.descending || this.query.limit) {
        throw new Error('reduce cannot follow reverse, page, noDocs, group, or reduce')
    }
    var copy = this.copy()
    copy.query.reduce = true
    delete copy.query.include_docs
    copy.refinement = 4
    return copy
}

VQ.prototype.exec = function(next) {
    return this.view._query(this.query).then(function(response) {
        return response.rows
    })
}
