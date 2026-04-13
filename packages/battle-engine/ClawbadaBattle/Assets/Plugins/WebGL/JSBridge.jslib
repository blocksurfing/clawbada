mergeInto(LibraryManager.library, {

    SendPositioningCommit: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onPositioningCommit) {
            window.__clawbada.onPositioningCommit(json);
        }
    },

    SendCombatCommit: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onCombatCommit) {
            window.__clawbada.onCombatCommit(json);
        }
    },

    SendLobsterSelected: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onLobsterSelected) {
            window.__clawbada.onLobsterSelected(json);
        }
    },

    SendUnityReady: function() {
        if (window.__clawbada && window.__clawbada.onUnityReady) {
            window.__clawbada.onUnityReady();
        }
    },

    SendAnimationComplete: function(jsonPtr) {
        var json = UTF8ToString(jsonPtr);
        if (window.__clawbada && window.__clawbada.onAnimationComplete) {
            window.__clawbada.onAnimationComplete(json);
        }
    }

});
