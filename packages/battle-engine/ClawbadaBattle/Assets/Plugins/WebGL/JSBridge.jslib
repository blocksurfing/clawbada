mergeInto(LibraryManager.library, {

    SendLobsterSelected: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onLobsterSelected) {
            window.__clawbada.onLobsterSelected(json);
        }
    },

    SendHexClicked: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onHexClicked) {
            window.__clawbada.onHexClicked(json);
        }
    },

    SendUnityReady: function() {
        if (window.__clawbada && window.__clawbada.onUnityReady) {
            window.__clawbada.onUnityReady();
        }
    },

    SendTurnAnimationComplete: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onTurnAnimationComplete) {
            window.__clawbada.onTurnAnimationComplete(json);
        }
    },

    SendActionSelected: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onActionSelected) {
            window.__clawbada.onActionSelected(json);
        }
    },

    SendUndoMove: function() {
        if (window.__clawbada && window.__clawbada.onUndoMove) {
            window.__clawbada.onUndoMove();
        }
    },

    // Editor demo loop (V2 round shape) — unused by live battles.
    SendAnimationComplete: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onAnimationComplete) {
            window.__clawbada.onAnimationComplete(json);
        }
    }

});
