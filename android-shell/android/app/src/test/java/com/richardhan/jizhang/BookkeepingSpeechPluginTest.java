package com.richardhan.jizhang;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import android.app.Activity;
import android.speech.RecognizerIntent;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class BookkeepingSpeechPluginTest {
    @Test
    public void selectsFirstUsableHypothesisWithoutBreakingMultiTransactionText() {
        String text = "昨天午餐 120，搭車 180";
        assertEquals(text, BookkeepingSpeechPlugin.transcriptFromResult(
                Activity.RESULT_OK, Arrays.asList(null, "  ", 1, " " + text + " \n", "晚餐 120")));
    }

    @Test
    public void cancelledActivityDoesNotUseEvenAnAttachedTranscript() {
        assertNull(BookkeepingSpeechPlugin.transcriptFromResult(
                Activity.RESULT_CANCELED, Collections.singletonList("不應採用的文字")));
    }

    @Test
    public void blankAndNoMatchResultsAreErrorsRatherThanDrafts() {
        assertThrows(IllegalStateException.class, () -> BookkeepingSpeechPlugin.transcriptFromResult(
                Activity.RESULT_OK, null));
        assertThrows(IllegalStateException.class, () -> BookkeepingSpeechPlugin.transcriptFromResult(
                Activity.RESULT_OK, Collections.singletonList("   ")));
        assertThrows(IllegalStateException.class, () -> BookkeepingSpeechPlugin.transcriptFromResult(
                RecognizerIntent.RESULT_NO_MATCH, null));
    }

    @Test
    public void recognizerFailureDoesNotLookLikeSuccessfulDictation() {
        assertThrows(IllegalStateException.class, () -> BookkeepingSpeechPlugin.transcriptFromResult(
                RecognizerIntent.RESULT_NETWORK_ERROR, Collections.singletonList("不應採用的文字")));
    }
}
