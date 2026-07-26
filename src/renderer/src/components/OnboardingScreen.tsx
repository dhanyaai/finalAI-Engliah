import Kitten from '@renderer/components/Kitten'
import { isWebChatMode } from '@renderer/api-web'
import styles from './OnboardingScreen.module.css'

interface OnboardingScreenProps {
  onStart: () => void
  aiName?: string
}

export default function OnboardingScreen({
  onStart,
  aiName = 'Kitten'
}: OnboardingScreenProps): React.JSX.Element {
  const webChat = isWebChatMode()

  return (
    <div className={styles.container}>
      <div className={styles.kittenWrapper}>
        <Kitten state="idle" />
      </div>

      <div className={styles.content}>
        <h2 className={styles.title}>Hi, I am {aiName}!</h2>
        <p className={styles.subtitle}>Your English-speaking friend</p>

        <div className={styles.steps}>
          {webChat ? (
            <>
              <div className={styles.step}>
                <span className={styles.stepIcon}>1</span>
                <span className={styles.stepText}>Type a message in the chat box below</span>
              </div>
              <div className={styles.step}>
                <span className={styles.stepIcon}>2</span>
                <span className={styles.stepText}>Press Send (or Enter) and I will reply</span>
              </div>
              <div className={styles.step}>
                <span className={styles.stepIcon}>3</span>
                <span className={styles.stepText}>
                  Use the subtitles toggle to show our full conversation
                </span>
              </div>
            </>
          ) : (
            <>
              <div className={styles.step}>
                <span className={styles.stepIcon}>1</span>
                <span className={styles.stepText}>
                  Press and hold the microphone button to talk to me
                </span>
              </div>
              <div className={styles.step}>
                <span className={styles.stepIcon}>2</span>
                <span className={styles.stepText}>
                  Let go when you finish speaking, and I will reply
                </span>
              </div>
              <div className={styles.step}>
                <span className={styles.stepIcon}>3</span>
                <span className={styles.stepText}>
                  You can also turn on subtitles to see our conversation
                </span>
              </div>
            </>
          )}
        </div>

        <button className={styles.startBtn} onClick={onStart} type="button">
          {webChat ? 'Start Chatting' : 'Start Talking'}
        </button>
      </div>
    </div>
  )
}
