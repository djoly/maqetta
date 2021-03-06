define([
    "dojo/_base/declare",
	"../drawing/Surface",
	"../drawing/tools/CreateTool",
	"../drawing/tools/ExchangeTool",
	"../drawing/tools/HighlightTool",
	"../drawing/tools/SelectTool",
	"davinci/Runtime",
	"davinci/ve/Context"
], function(declare, Surface, CreateTool, ExchangeTool, HighlightTool, SelectTool, Runtime, Context) {
	
return declare("davinci.review.editor.Context", [Context], {

	setSource: function(){
		var containerNode = this.containerNode;
		var versionInfo = this.resourceFile.parent;
		if (!versionInfo.width)
			containerNode.style.overflowX = "hidden";
		if (!versionInfo.height)
			containerNode.style.overflowY = "hidden";
		if (!this.frame) {
			this.frame = dojo.create("iframe", {
				style: {
					border: "0",
					width: versionInfo.width&&versionInfo.height?versionInfo.width+"px":"100%",
					height: versionInfo.width&&versionInfo.height?versionInfo.height+"px":"100%"
				},
				src: this.baseURL,
				onload: dojo.hitch(this,function(){
					this._initDrawing();
					dojo.publish("/davinci/review/context/loaded", 
							[
							 this,
							 this.fileName,
							 davinci.Runtime.commenting_commentId
							 ]);
				})
			}, containerNode);
		}
	},

	getSelection: function() {
		return []; // Overridden for NOOP behavior
	},

	_initDrawing: function() {
		// summary:
		//        Create the canvas for annotations, and wait for the shape definition
		//        to add a shape. The shapes will be created one by one.
		//        Shapes with commentId, state and colorAlias(reviewer)
		var doc = this.getDocument(), 
			surface = doc.annotationSurface;
		if (!doc.annotationSurface) {
			surface = doc.annotationSurface = new Surface(doc.body, doc);
			new CreateTool(surface, ["commentId"]);
			new SelectTool(surface, ["commentId"]).activate();
			new ExchangeTool(surface, ["commentId"]);
			new HighlightTool(surface).activate();
		}
		this._cxtConns = [
			 dojo.connect(surface.highlightTool, "onShapeMouseDown", function(shape) {
				 dojo.publish("/davinci/review/drawing/annotationSelected", [shape.commentId]);
			 }),
			 dojo.connect(this.getContainerNode(), "click", dojo.hitch(this, function(evt) {
				 if (!this.containerEditor.isDirty && evt.target === this.getContainerNode()) {
					 dojo.publish("/davinci/review/view/canvasFocused", [this]);
				 }
			 }))
			];
		this._cxtSubs = [
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/addShape", function(shapeDef, clear, editor) {
				 surface.exchangeTool.importShapes(shapeDef, clear, dojo.hitch(Runtime, Runtime.getColor)); // FIXME: Unique surface is required
			 }),
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/enableEditing", this, function(reviewer, commentId, pageState) {
				 surface.activate();
				 surface.cached = surface.exchangeTool.exportShapesByAttribute();
				 surface.currentReviewer = reviewer;
				 surface.commentId = commentId;
				 surface.filterState = pageState;
				 surface.filterComments = [commentId];                
				 this._refreshSurface(surface);
			 }),
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/getShapesInEditing", dojo.hitch(this,function(obj, state) {
				 if (obj._currentPage != this.fileName) {
					 return;
				 }
				 surface.selectTool.deselectShape();
				 surface.setValueByAttribute("commentId", surface.commentId, "state", state);
				 obj.drawingJson = surface.exchangeTool.exportShapesByAttribute("commentId", [surface.commentId]);
				 surface.deactivate();
				 surface.commentId = "";
			 })),
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/cancelEditing", dojo.hitch(this, function() {
				 // Restore the previous status
				 surface.exchangeTool.importShapes(surface.cached, true, dojo.hitch(Runtime, Runtime.getColor)); // FIXME: Unique surface is required
				 surface.deactivate();
				 this._refreshSurface(surface);
				 surface.commentId = ""; // Clear the filter so that no shapes can be selected
			 })),
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/filter", dojo.hitch(this,function(pageState, /*Array*/commentIds) {
				 surface.filterState = pageState;
				 surface.filterComments = commentIds;                
				 this._refreshSurface(surface);
			 })),
			 dojo.subscribe(this.fileName+"/davinci/review/drawing/setShownColorAliases", dojo.hitch(this,function(colorAliases) {
				 surface.filterColorAliases = colorAliases;
				 this._refreshSurface(surface);
			 })),
			 dojo.subscribe("/davinci/review/view/openComment", dojo.hitch(this, function() {
				 this.containerEditor.isDirty = true;
			 })),
			 dojo.subscribe("/davinci/review/view/closeComment", dojo.hitch(this, function() {
				 this.containerEditor.isDirty = false;
			 })),
			 dojo.subscribe("/davinci/ui/editorSelected", dojo.hitch(this, function(obj){
				 if (obj.oldEditor!=null && this === obj.oldEditor.getContext()) {
					 // Determine if the editor is closed, if the editor is closed then
					 // getDocument() will throw an exception
					 try {
						 this.getDocument();
					 } catch(err) {
						 // The editor is closed now
						 this._destroyDrawing();
					 }
				 }
			 }))
		];
	},

	_refreshSurface: function(surface) {
		var shapes = surface.shapes, result;

		dojo.forEach(shapes, function(shape) {
			result = "hidden";
			if (dojo.some(surface.filterColorAliases, function(colorAlias) {
				//FIXME: Hack to fix #1486 just before Preview 4 release
				// Old code - quick check - covers case where server uses same string for username and email
				if (shape.colorAlias == colorAlias) {
					return true;
				} else if(davinci && davinci.review && dojo.isArray(Runtime.reviewers)) {
					// New code hack - see if colorAlias matches either username or email corresponding to shape.colorAlias
					var reviewers = Runtime.reviewers;
					var found = false;
					for (var i=0; i<reviewers.length; i++) {
						if (colorAlias == reviewers[i].name || colorAlias == reviewers[i].email) {
							found = true;
							break;
						}
					}
					if (found) {
						if (shape.colorAlias == reviewers[i].name || shape.colorAlias == reviewers[i].email) {
							return true;
						}
					}
					return false;
				}
			})) {
				if (surface.filterComments && surface.filterComments.length > 0) {
					if (dojo.some(surface.filterComments, function(commentId) { 
						return shape.commentId == commentId;
					})){
						result = "visible";
						surface.highlightTool && (surface.highlightTool.shape = shape);
					} else {
						result = "partial";
					}
					if (shape.state != surface.filterState) {
						result = "hidden";
					}
				} else {
					if (shape.state == surface.filterState) {
						result = "visible";
					} else {
						result = "hidden";
					}
				}
			}
			if (shape.commentId == surface.commentId) {
				// Keep the shapes in editing
				result = "visible";
			}
			shape.setVisible(result);
		});
	},

	_destroyDrawing: function() {
		try {
			var doc = this.getDocument(), surface = (doc && doc.annotationSurface);
			if (surface) {
				surface.destroy();
			}
		} catch(err) { /*Do nothing*/ }
		dojo.forEach(this._cxtConns, dojo.disconnect);
		dojo.forEach(this._cxtSubs, dojo.unsubscribe);
		doc && delete doc.annotationSureface;
	}

});
});
